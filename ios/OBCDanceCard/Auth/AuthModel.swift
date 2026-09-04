//
//  AuthModel.swift
//  Central auth/member state — the Swift mirror of `web/src/auth/AuthProvider.tsx`.
//  Subscribes to Firebase Auth state and, once signed in, to the caller's own
//  `members/{uid}` and `memberPrivate/{uid}` documents (rules allow self-read
//  for both — plan §10).
//
//  `status`:
//   * `.loading`   — auth state (or the member doc) hasn't resolved yet
//   * `.signedOut` — no Firebase Auth user
//   * `.signedIn`  — Auth user + an active member doc
//   * `.notActive` — Auth user, but the member doc is missing, `active !=
//     true`, or reading it failed with `permission-denied` — which is exactly
//     what a deactivated member's rules evaluation returns, since reading
//     `members/{id}` requires `active == true` for anyone but an admin or the
//     doc's own still-active self. Nothing under `member`/`memberPrivate` is
//     ever exposed in this state.
//
//  Session persistence is the Firebase SDK default (Keychain) — plan §2. This
//  file never stores a token itself.
//

import Combine
import FirebaseAppCheck
import FirebaseAuth
import FirebaseFirestore
import Foundation

enum AuthStatus: Equatable {
    case loading, signedOut, signedIn, notActive
    /// Signed in, but the member doc can't be read for a reason that is not
    /// "you're not a member": Firestore is denying this *build* (an App
    /// Check token the project doesn't accept) or is unreachable. Shown with
    /// a retry, never as a membership verdict.
    case unavailable
}

@MainActor
final class AuthModel: ObservableObject {
    @Published private(set) var status: AuthStatus = .loading
    @Published private(set) var member: Member?
    @Published private(set) var memberPrivate: MemberPrivate?

    /// The signed-in member's id, only while genuinely signed in and active.
    var memberId: String? { status == .signedIn ? member?.id : nil }

    private enum MemberDocState { case pending, active, notActive, unavailable }

    private var authHandle: AuthStateDidChangeListenerHandle?
    private var memberListener: ListenerRegistration?
    private var privateListener: ListenerRegistration?
    private var authReady = false
    private var user: User?
    private var memberDocState: MemberDocState = .pending

    /// Called when a sign-out happens, so the app can unregister this device
    /// for push (plan §14.2 "unregisterDevice on sign-out").
    var onSignOut: (() async -> Void)?

    func start() {
        guard authHandle == nil else { return }
        authHandle = FirebaseService.auth.addStateDidChangeListener { [weak self] _, user in
            Task { @MainActor in
                guard let self else { return }
                self.user = user
                self.authReady = true
                if user == nil {
                    self.stopMemberListeners()
                    self.member = nil
                    self.memberPrivate = nil
                    self.memberDocState = .pending
                } else if self.listeningUid != user!.uid {
                    // A re-sign-in for the *same* member — the Profile's
                    // inline set-password re-auth (plan §8.2, audit M1)
                    // signs in again with a fresh custom token — must not
                    // restart the listeners: that flips status to .loading
                    // and tears down the screen the member is standing on,
                    // which is exactly the "navigated away" the fix exists
                    // to avoid. The docs haven't changed; keep them.
                    self.startMemberListeners(uid: user!.uid)
                }
                self.recomputeStatus()
            }
        }
    }

    private func startMemberListeners(uid: String) {
        stopMemberListeners()
        listeningUid = uid
        memberDocState = .pending
        recomputeStatus()

        memberListener = FirebaseService.db.document(Paths.member(uid))
            .addSnapshotListener { [weak self] snapshot, error in
                Task { @MainActor in
                    guard let self else { return }
                    if let error {
                        let ns = error as NSError
                        // Only a rules denial means "not a member": a
                        // deactivated member's read of their own doc is
                        // denied (plan §10). Anything else — offline,
                        // unavailable, a TLS or App Check problem — is a
                        // connection failure, and telling someone their
                        // membership has lapsed because the Wi-Fi dropped
                        // would be exactly the wrong message. Those keep
                        // the current state; the listener retries itself.
                        let denied = ns.domain == FirestoreErrorDomain
                            && ns.code == FirestoreErrorCode.permissionDenied.rawValue
                        guard denied else {
                            self.debugReason("member_doc_error \(ns.domain) \(ns.code) transient")
                            return
                        }
                        // A denial has two possible authors, and they look
                        // identical to a client: the rules (deactivated
                        // member) or App Check (this build isn't accepted —
                        // an unregistered debug token, or a device whose
                        // attestation failed). Ask App Check which before
                        // telling anyone their membership has lapsed.
                        self.classifyDenial()
                        return
                    }
                    guard let snapshot, snapshot.exists else {
                        self.debugReason("member_doc_missing")
                        self.member = nil
                        self.memberDocState = .notActive
                        self.recomputeStatus()
                        return
                    }
                    let decoded: Member
                    do {
                        decoded = try snapshot.data(as: Member.self)
                    } catch {
                        // A shape this build can't read is a client bug, not
                        // a membership fact — but there is nothing safe to
                        // show, so it lands on the same screen. The reason
                        // (key + expected type) is what fixes it.
                        self.debugReason("member_doc_decode_failed \(error)")
                        self.member = nil
                        self.memberDocState = .notActive
                        self.recomputeStatus()
                        return
                    }
                    if !decoded.active { self.debugReason("member_doc_inactive") }
                    self.member = decoded
                    self.memberDocState = decoded.active ? .active : .notActive
                    self.recomputeStatus()
                }
            }

        privateListener = FirebaseService.db.document(Paths.memberPrivate(uid))
            .addSnapshotListener { [weak self] snapshot, error in
                Task { @MainActor in
                    guard let self else { return }
                    if error != nil || snapshot?.exists != true {
                        self.memberPrivate = nil
                        return
                    }
                    self.memberPrivate = try? snapshot?.data(as: MemberPrivate.self)
                }
            }
    }

    /// Resolves a `permission-denied` on the member doc into either
    /// `.notActive` (rules) or `.unavailable` (App Check refused this build).
    private func classifyDenial() {
        Task { @MainActor in
            do {
                _ = try await AppCheck.appCheck().token(forcingRefresh: false)
                // App Check is fine, so the rules said no: not an active member.
                self.debugReason("member_doc_denied app_check=ok -> notActive")
                self.member = nil
                self.memberDocState = .notActive
            } catch {
                let ns = error as NSError
                self.debugReason("member_doc_denied app_check_failed \(ns.domain) \(ns.code) -> unavailable")
                self.member = nil
                self.memberDocState = .unavailable
            }
            self.recomputeStatus()
        }
    }

    /// "Try again" from the unavailable screen: re-subscribe, which also
    /// re-exchanges the App Check token.
    func retry() {
        guard let user else { return }
        startMemberListeners(uid: user.uid)
    }

    /// The uid the member listeners are currently attached for.
    private var listeningUid: String?

    private func stopMemberListeners() {
        listeningUid = nil
        memberListener?.remove()
        memberListener = nil
        privateListener?.remove()
        privateListener = nil
    }

    /// DEBUG-only: why the session landed where it did. Codes, keys and
    /// type names only — never a document's contents (plan §3.7).
    private func debugReason(_ line: String) {
        #if DEBUG
        print("member_state_reason \(line)")
        #endif
    }

    private func recomputeStatus() {
        if !authReady { status = .loading; return }
        if user == nil { status = .signedOut; return }
        switch memberDocState {
        case .pending: status = .loading
        case .active: status = .signedIn
        case .notActive: status = .notActive
        case .unavailable: status = .unavailable
        }
    }

    // MARK: - Actions

    /// Completes the emailed-code flow (plan §8.2 step 5).
    func signIn(withCustomToken token: String) async throws {
        try await FirebaseService.auth.signIn(withCustomToken: token)
    }

    /// Password sign-in. The caller maps failures through
    /// `ErrorMapper.passwordSignIn`, which is deliberately blind to *why* it
    /// failed (plan §8.1 enumeration protection).
    func signIn(email: String, password: String) async throws {
        try await FirebaseService.auth.signIn(
            withEmail: email.trimmingCharacters(in: .whitespaces).lowercased(),
            password: password
        )
    }

    func signOut() async {
        // Unregister this device's push token *before* dropping the session —
        // the callable needs to be authenticated to find the member.
        await onSignOut?()
        try? FirebaseService.auth.signOut()
    }
}

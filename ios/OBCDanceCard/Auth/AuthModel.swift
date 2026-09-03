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
import FirebaseAuth
import FirebaseFirestore
import Foundation

enum AuthStatus: Equatable {
    case loading, signedOut, signedIn, notActive
}

@MainActor
final class AuthModel: ObservableObject {
    @Published private(set) var status: AuthStatus = .loading
    @Published private(set) var member: Member?
    @Published private(set) var memberPrivate: MemberPrivate?

    /// The signed-in member's id, only while genuinely signed in and active.
    var memberId: String? { status == .signedIn ? member?.id : nil }

    private enum MemberDocState { case pending, active, notActive }

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
                } else {
                    self.startMemberListeners(uid: user!.uid)
                }
                self.recomputeStatus()
            }
        }
    }

    private func startMemberListeners(uid: String) {
        stopMemberListeners()
        memberDocState = .pending
        recomputeStatus()

        memberListener = FirebaseService.db.document(Paths.member(uid))
            .addSnapshotListener { [weak self] snapshot, error in
                Task { @MainActor in
                    guard let self else { return }
                    if error != nil {
                        // A deactivated member's read of their own doc is
                        // denied by rules (plan §10) — that arrives here.
                        self.member = nil
                        self.memberDocState = .notActive
                        self.recomputeStatus()
                        return
                    }
                    guard let snapshot, snapshot.exists,
                          let decoded = try? snapshot.data(as: Member.self) else {
                        self.member = nil
                        self.memberDocState = .notActive
                        self.recomputeStatus()
                        return
                    }
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

    private func stopMemberListeners() {
        memberListener?.remove()
        memberListener = nil
        privateListener?.remove()
        privateListener = nil
    }

    private func recomputeStatus() {
        if !authReady { status = .loading; return }
        if user == nil { status = .signedOut; return }
        switch memberDocState {
        case .pending: status = .loading
        case .active: status = .signedIn
        case .notActive: status = .notActive
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

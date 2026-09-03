//
//  Stores.swift
//  Live Firestore subscriptions, one observable store per collection — the
//  Swift equivalent of the web app's context providers
//  (`ProgrammeProvider`, `MembersDirectoryProvider`, `InvitesProvider`,
//  `NotificationsProvider`, `TeamsProvider`, `VisitorsProvider`).
//
//  Every store follows the same shape: `addSnapshotListener` on the same
//  query the web app uses, decode into the `Codable` models, and surface a
//  failure as a display-safe `subscriptionError` rather than swallowing it
//  (plan §14.2 "reads are live listeners with error handling surfaced in the
//  UI"). Errors are logged by *code only* — never the document contents,
//  which carry member PII (plan §3.7).
//
//  Reads are the only thing that happens here. Nothing in this file writes to
//  Firestore: every mutation is a callable (plan §3.3), the single exception
//  being `markNotificationsRead`, which is itself a callable anyway.
//

import Combine
import FirebaseAuth
import FirebaseFirestore
import Foundation

/// A display-safe "we couldn't load this" marker. Mirrors the web app's
/// `SubscriptionError` component, which shows the resource name and nothing
/// about the underlying failure.
struct SubscriptionError: Equatable {
    var code: String
    var resource: String

    var message: String {
        "Couldn't load \(resource). Check your connection and pull to refresh."
    }
}

private func logSubscriptionFailure(_ name: String, _ error: Error) {
    // Code only — never the query, the path, or any document content.
    let code = (error as NSError).code
    print("subscription_failed \(name) \(code)")
}

// MARK: - Programme

/// The latest **published** programme and its weekdays/series/sessions.
/// Drafts are invisible to members at the rules layer, so there is nothing to
/// filter client-side.
@MainActor
final class ProgrammeStore: ObservableObject {
    @Published private(set) var programme: Programme?
    @Published private(set) var weekdays: [WeekdayProgramme] = []
    @Published private(set) var series: [Series] = []
    @Published private(set) var sessions: [Session] = []
    @Published private(set) var loading = true
    @Published private(set) var error: SubscriptionError?

    var year: Int? { programme?.year }

    private var programmeListener: ListenerRegistration?
    private var subListeners: [ListenerRegistration] = []
    private var programmeLoaded = false
    private var subsLoaded = false

    func start() {
        guard programmeListener == nil else { return }
        let query = FirebaseService.db.collection(Paths.programmes)
            .whereField("status", isEqualTo: ProgrammeStatus.published.rawValue)
            .order(by: "year", descending: true)
            .limit(to: 1)

        programmeListener = query.addSnapshotListener { [weak self] snapshot, error in
            guard let self else { return }
            Task { @MainActor in
                if let error {
                    logSubscriptionFailure("programme", error)
                    self.programme = nil
                    self.error = SubscriptionError(code: "\((error as NSError).code)", resource: "the programme")
                    self.programmeLoaded = true
                    self.updateLoading()
                    return
                }
                let previousYear = self.programme?.year
                self.programme = snapshot?.documents.first.flatMap { try? $0.data(as: Programme.self) }
                self.error = nil
                self.programmeLoaded = true
                self.updateLoading()
                if self.programme?.year != previousYear { self.restartSubcollections() }
            }
        }
    }

    func stop() {
        programmeListener?.remove()
        programmeListener = nil
        subListeners.forEach { $0.remove() }
        subListeners = []
        programmeLoaded = false
        subsLoaded = false
    }

    private func updateLoading() {
        loading = !programmeLoaded || !subsLoaded
    }

    private func restartSubcollections() {
        subListeners.forEach { $0.remove() }
        subListeners = []

        guard let year else {
            weekdays = []
            series = []
            sessions = []
            subsLoaded = true
            updateLoading()
            return
        }

        subsLoaded = false
        updateLoading()
        var weekdaysDone = false, seriesDone = false, sessionsDone = false
        let markDone = { [weak self] in
            guard let self else { return }
            if weekdaysDone && seriesDone && sessionsDone {
                self.subsLoaded = true
                self.updateLoading()
            }
        }

        let db = FirebaseService.db
        subListeners.append(db.collection(Paths.weekdays(year)).addSnapshotListener { [weak self] snap, err in
            Task { @MainActor in
                guard let self else { return }
                if let err {
                    logSubscriptionFailure("weekdays", err)
                    self.error = SubscriptionError(code: "\((err as NSError).code)", resource: "the programme")
                } else {
                    self.weekdays = snap?.documents.compactMap { try? $0.data(as: WeekdayProgramme.self) } ?? []
                }
                weekdaysDone = true
                markDone()
            }
        })

        subListeners.append(db.collection(Paths.series(year)).addSnapshotListener { [weak self] snap, err in
            Task { @MainActor in
                guard let self else { return }
                if let err {
                    logSubscriptionFailure("series", err)
                    self.error = SubscriptionError(code: "\((err as NSError).code)", resource: "the programme")
                } else {
                    self.series = snap?.documents.compactMap { try? $0.data(as: Series.self) } ?? []
                }
                seriesDone = true
                markDone()
            }
        })

        subListeners.append(db.collection(Paths.sessions(year)).addSnapshotListener { [weak self] snap, err in
            Task { @MainActor in
                guard let self else { return }
                if let err {
                    logSubscriptionFailure("sessions", err)
                    self.error = SubscriptionError(code: "\((err as NSError).code)", resource: "the programme")
                } else {
                    self.sessions = snap?.documents.compactMap { try? $0.data(as: Session.self) } ?? []
                }
                sessionsDone = true
                markDone()
            }
        })
    }

    func session(id: String) -> Session? { sessions.first { $0.id == id } }
    func series(id: String?) -> Series? {
        guard let id else { return nil }
        return series.first { $0.id == id }
    }
    func weekday(_ weekday: Weekday) -> WeekdayProgramme? {
        weekdays.first { $0.weekday == weekday }
    }
}

// MARK: - Members directory

/// Every **active** member. Names, grades and phone numbers are visible to
/// members by design (booklet parity, plan §2 "Visibility"); emails and
/// device tokens are not, and live in `memberPrivate`, which this never reads.
@MainActor
final class MembersDirectoryStore: ObservableObject {
    @Published private(set) var members: [Member] = []
    @Published private(set) var byId: [String: Member] = [:]
    @Published private(set) var loading = true
    @Published private(set) var error: SubscriptionError?

    private var listener: ListenerRegistration?

    func start() {
        guard listener == nil else { return }
        listener = FirebaseService.db.collection(Paths.members)
            .whereField("active", isEqualTo: true)
            .addSnapshotListener { [weak self] snap, err in
                Task { @MainActor in
                    guard let self else { return }
                    if let err {
                        logSubscriptionFailure("members", err)
                        self.members = []
                        self.byId = [:]
                        self.error = SubscriptionError(code: "\((err as NSError).code)", resource: "the member list")
                    } else {
                        let decoded = snap?.documents.compactMap { try? $0.data(as: Member.self) } ?? []
                        self.members = decoded
                        self.byId = Dictionary(uniqueKeysWithValues: decoded.map { ($0.id, $0) })
                        self.error = nil
                    }
                    self.loading = false
                }
            }
    }

    func stop() {
        listener?.remove()
        listener = nil
    }

    /// Mirrors the web app's `nameOf`: an unknown id reads "A member" rather
    /// than leaking a raw uid into the UI.
    func nameOf(_ memberId: String) -> String {
        byId[memberId]?.fullName ?? "A member"
    }
}

// MARK: - Invites

@MainActor
final class InvitesStore: ObservableObject {
    @Published private(set) var incoming: [Invite] = []
    @Published private(set) var outgoing: [Invite] = []
    @Published private(set) var resolved: [Invite] = []
    @Published private(set) var loading = true
    @Published private(set) var error: SubscriptionError?

    private static let resolvedStatuses = ["accepted", "declined", "expired", "cancelled"]
    private static let resolvedLimit = 10

    private var listeners: [ListenerRegistration] = []
    private var resolvedToMe: [Invite] = []
    private var resolvedFromMe: [Invite] = []
    private var currentUid: String?

    var pendingCount: Int { incoming.count }

    func start(uid: String?) {
        guard uid != currentUid || listeners.isEmpty else { return }
        stop()
        currentUid = uid
        guard let uid else {
            incoming = []; outgoing = []; resolved = []
            loading = false
            return
        }
        loading = true

        let invites = FirebaseService.db.collection(Paths.invites)

        listeners.append(
            invites
                .whereField("toMemberId", isEqualTo: uid)
                .whereField("status", isEqualTo: InviteStatus.pending.rawValue)
                .order(by: "createdAt", descending: true)
                .addSnapshotListener { [weak self] snap, err in
                    Task { @MainActor in
                        self?.apply(snap, err, name: "invites_incoming") { $0.incoming = $1 }
                    }
                }
        )

        listeners.append(
            invites
                .whereField("fromMemberId", isEqualTo: uid)
                .whereField("status", isEqualTo: InviteStatus.pending.rawValue)
                .order(by: "createdAt", descending: true)
                .addSnapshotListener { [weak self] snap, err in
                    Task { @MainActor in
                        self?.apply(snap, err, name: "invites_outgoing") { $0.outgoing = $1 }
                    }
                }
        )

        listeners.append(
            invites
                .whereField("toMemberId", isEqualTo: uid)
                .whereField("status", in: Self.resolvedStatuses)
                .order(by: "createdAt", descending: true)
                .limit(to: Self.resolvedLimit)
                .addSnapshotListener { [weak self] snap, err in
                    Task { @MainActor in
                        self?.apply(snap, err, name: "invites_resolved_to_me") {
                            $0.resolvedToMe = $1
                            $0.recomputeResolved()
                        }
                    }
                }
        )

        listeners.append(
            invites
                .whereField("fromMemberId", isEqualTo: uid)
                .whereField("status", in: Self.resolvedStatuses)
                .order(by: "createdAt", descending: true)
                .limit(to: Self.resolvedLimit)
                .addSnapshotListener { [weak self] snap, err in
                    Task { @MainActor in
                        self?.apply(snap, err, name: "invites_resolved_from_me") {
                            $0.resolvedFromMe = $1
                            $0.recomputeResolved()
                        }
                    }
                }
        )
    }

    func stop() {
        listeners.forEach { $0.remove() }
        listeners = []
        currentUid = nil
    }

    private func apply(
        _ snapshot: QuerySnapshot?,
        _ error: Error?,
        name: String,
        assign: (InvitesStore, [Invite]) -> Void
    ) {
        if let error {
            logSubscriptionFailure(name, error)
            self.error = SubscriptionError(code: "\((error as NSError).code)", resource: "invites")
        } else {
            assign(self, snapshot?.documents.compactMap { try? $0.data(as: Invite.self) } ?? [])
            self.error = nil
        }
        loading = false
    }

    private func recomputeResolved() {
        resolved = (resolvedToMe + resolvedFromMe)
            .sorted { ($0.updatedAt ?? "") > ($1.updatedAt ?? "") }
            .prefix(Self.resolvedLimit)
            .map { $0 }
    }
}

// MARK: - Notifications

@MainActor
final class NotificationsStore: ObservableObject {
    @Published private(set) var notifications: [AppNotification] = []
    @Published private(set) var loading = true
    @Published private(set) var error: SubscriptionError?

    private static let feedLimit = 50
    private var listener: ListenerRegistration?
    private var currentUid: String?

    var unreadCount: Int { notifications.filter { !$0.read }.count }

    func start(uid: String?) {
        guard uid != currentUid || listener == nil else { return }
        stop()
        currentUid = uid
        guard let uid else {
            notifications = []
            loading = false
            return
        }
        loading = true

        listener = FirebaseService.db.collection(Paths.notifications)
            .whereField("memberId", isEqualTo: uid)
            .order(by: "createdAt", descending: true)
            .limit(to: Self.feedLimit)
            .addSnapshotListener { [weak self] snap, err in
                Task { @MainActor in
                    guard let self else { return }
                    if let err {
                        logSubscriptionFailure("notifications", err)
                        self.notifications = []
                        self.error = SubscriptionError(code: "\((err as NSError).code)", resource: "notifications")
                    } else {
                        self.notifications = snap?.documents.compactMap { try? $0.data(as: AppNotification.self) } ?? []
                        self.error = nil
                    }
                    self.loading = false
                }
            }
    }

    func stop() {
        listener?.remove()
        listener = nil
        currentUid = nil
    }
}

// MARK: - Teams

@MainActor
final class TeamsStore: ObservableObject {
    @Published private(set) var teams: [Team] = []
    @Published private(set) var loading = true
    @Published private(set) var error: SubscriptionError?

    private var listener: ListenerRegistration?
    private var selfId: String?

    func start(selfId: String?) {
        self.selfId = selfId
        guard listener == nil else { return }
        listener = FirebaseService.db.collection(Paths.teams)
            .whereField("status", in: [TeamStatus.forming.rawValue, TeamStatus.active.rawValue])
            .addSnapshotListener { [weak self] snap, err in
                Task { @MainActor in
                    guard let self else { return }
                    if let err {
                        logSubscriptionFailure("teams", err)
                        self.teams = []
                        self.error = SubscriptionError(code: "\((err as NSError).code)", resource: "teams")
                    } else {
                        self.teams = snap?.documents.compactMap { try? $0.data(as: Team.self) } ?? []
                        self.error = nil
                    }
                    self.loading = false
                }
            }
    }

    func stop() {
        listener?.remove()
        listener = nil
    }

    func teams(forSeries seriesId: String) -> [Team] {
        teams.filter { $0.seriesId == seriesId }
    }

    /// The signed-in member's team in a series, if they're on one.
    func myTeam(forSeries seriesId: String) -> Team? {
        guard let selfId else { return nil }
        return teams.first {
            $0.seriesId == seriesId && $0.members.contains { $0.ref.memberId == selfId }
        }
    }

    func team(id: String) -> Team? { teams.first { $0.id == id } }
}

// MARK: - Visitors

@MainActor
final class VisitorsStore: ObservableObject {
    @Published private(set) var visitors: [Visitor] = []
    @Published private(set) var loading = true
    @Published private(set) var error: SubscriptionError?

    private var listener: ListenerRegistration?
    private var currentUid: String?

    func start(uid: String?) {
        guard uid != currentUid || listener == nil else { return }
        stop()
        currentUid = uid
        guard let uid else {
            visitors = []
            loading = false
            return
        }
        loading = true

        listener = FirebaseService.db.collection(Paths.visitors)
            .whereField("createdByMemberId", isEqualTo: uid)
            .order(by: "lastUsedAt", descending: true)
            .addSnapshotListener { [weak self] snap, err in
                Task { @MainActor in
                    guard let self else { return }
                    if let err {
                        logSubscriptionFailure("visitors", err)
                        self.visitors = []
                        self.error = SubscriptionError(code: "\((err as NSError).code)", resource: "your visitors")
                    } else {
                        self.visitors = snap?.documents.compactMap { try? $0.data(as: Visitor.self) } ?? []
                        self.error = nil
                    }
                    self.loading = false
                }
            }
    }

    func stop() {
        listener?.remove()
        listener = nil
        currentUid = nil
    }
}

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

func logSubscriptionFailure(_ name: String, _ error: Error) {
    // DEBUG only, and code only — never the query, the path, or any
    // document content (plan §3.7).
    #if DEBUG
    let code = (error as NSError).code
    print("subscription_failed \(name) \(code)")
    #endif
}

// MARK: - Programme

/// Every **published** programme year the club currently has, merged into
/// one year-tagged view (plan §21 B3: the next year's programme is published
/// before the current one ends, and members book across the boundary).
///
/// Subscribes to the newest `maxYears` published `programmes/{year}` docs
/// and, per year, to that year's weekdays/series/sessions. Drafts are
/// invisible to members at the rules layer, so nothing is filtered here.
///
/// **Id-collision warning:** `seriesId` is `${weekday}-${slug(name)}` and
/// weekday doc ids are the `Weekday` value — both repeat across years.
/// Session ids embed the date and are globally unique. So every series /
/// weekday lookup here is year-qualified, and the merged arrays are kept
/// newest-year-first so a plain "first match" means "prefer the newest
/// year's doc".
@MainActor
final class ProgrammeStore: ObservableObject {
    /// Newest first.
    @Published private(set) var programmes: [Programme] = []
    /// Every loaded year's docs, each stamped with its `year`, newest year first.
    @Published private(set) var weekdays: [WeekdayProgramme] = []
    @Published private(set) var series: [Series] = []
    @Published private(set) var sessions: [Session] = []
    @Published private(set) var loading = true
    @Published private(set) var error: SubscriptionError?

    /// How many of the newest published years to load (current + next + one back).
    static let maxYears = 3

    /// Published years currently loaded, newest first.
    var years: [Int] { programmes.map(\.year) }
    /// The newest published year — for headings; nil when nothing is published.
    var year: Int? { years.first }
    var programme: Programme? { programmes.first }

    private struct YearData {
        var weekdays: [WeekdayProgramme] = []
        var series: [Series] = []
        var sessions: [Session] = []
        var weekdaysLoaded = false, seriesLoaded = false, sessionsLoaded = false
        var loaded: Bool { weekdaysLoaded && seriesLoaded && sessionsLoaded }
    }

    private var programmesListener: ListenerRegistration?
    private var yearListeners: [Int: [ListenerRegistration]] = [:]
    private var yearData: [Int: YearData] = [:]
    private var programmesLoaded = false

    func start() {
        guard programmesListener == nil else { return }
        programmesListener = FirebaseService.db.collection(Paths.programmes)
            .whereField("status", isEqualTo: ProgrammeStatus.published.rawValue)
            .order(by: "year", descending: true)
            .limit(to: Self.maxYears)
            .addSnapshotListener { [weak self] snapshot, error in
                Task { @MainActor in
                    guard let self else { return }
                    if let error {
                        logSubscriptionFailure("programmes", error)
                        self.programmes = []
                        self.error = SubscriptionError(code: "\((error as NSError).code)", resource: "the programme")
                    } else {
                        self.programmes = snapshot?.documents.compactMap { try? $0.data(as: Programme.self) } ?? []
                        self.error = nil
                    }
                    self.programmesLoaded = true
                    self.reconcileYearListeners()
                    self.recompute()
                }
            }
    }

    func stop() {
        programmesListener?.remove()
        programmesListener = nil
        yearListeners.values.forEach { $0.forEach { $0.remove() } }
        yearListeners = [:]
        yearData = [:]
        programmesLoaded = false
        loading = true
    }

    /// Subscribe to newly published years, drop years that fell out of the window.
    private func reconcileYearListeners() {
        let wanted = Set(years)
        for (y, ls) in yearListeners where !wanted.contains(y) {
            ls.forEach { $0.remove() }
            yearListeners[y] = nil
            yearData[y] = nil
        }
        for y in wanted where yearListeners[y] == nil {
            yearData[y] = YearData()
            let db = FirebaseService.db
            yearListeners[y] = [
                db.collection(Paths.weekdays(y)).addSnapshotListener { [weak self] snap, err in
                    Task { @MainActor in
                        guard let self, self.yearData[y] != nil else { return }
                        if let err { logSubscriptionFailure("weekdays", err); self.error = SubscriptionError(code: "\((err as NSError).code)", resource: "the programme") }
                        else {
                            self.yearData[y]?.weekdays = (snap?.documents.compactMap { try? $0.data(as: WeekdayProgramme.self) } ?? []).map { var w = $0; w.year = y; return w }
                        }
                        self.yearData[y]?.weekdaysLoaded = true
                        self.recompute()
                    }
                },
                db.collection(Paths.series(y)).addSnapshotListener { [weak self] snap, err in
                    Task { @MainActor in
                        guard let self, self.yearData[y] != nil else { return }
                        if let err { logSubscriptionFailure("series", err); self.error = SubscriptionError(code: "\((err as NSError).code)", resource: "the programme") }
                        else {
                            self.yearData[y]?.series = (snap?.documents.compactMap { try? $0.data(as: Series.self) } ?? []).map { var s = $0; s.year = y; return s }
                        }
                        self.yearData[y]?.seriesLoaded = true
                        self.recompute()
                    }
                },
                db.collection(Paths.sessions(y)).addSnapshotListener { [weak self] snap, err in
                    Task { @MainActor in
                        guard let self, self.yearData[y] != nil else { return }
                        if let err { logSubscriptionFailure("sessions", err); self.error = SubscriptionError(code: "\((err as NSError).code)", resource: "the programme") }
                        else {
                            self.yearData[y]?.sessions = snap?.documents.compactMap { try? $0.data(as: Session.self) } ?? []
                        }
                        self.yearData[y]?.sessionsLoaded = true
                        self.recompute()
                    }
                },
            ]
        }
    }

    /// Rebuilds the merged, newest-year-first arrays.
    private func recompute() {
        let ordered = years.compactMap { y in yearData[y].map { (y, $0) } }
        weekdays = ordered.flatMap { $0.1.weekdays }
        series = ordered.flatMap { $0.1.series }
        sessions = ordered.flatMap { $0.1.sessions }
        loading = !programmesLoaded || ordered.contains { !$0.1.loaded } || ordered.count != years.count
    }

    // MARK: Lookups (year-qualified — see the id-collision warning above)

    /// Session ids are globally unique, so no year is needed.
    func session(id: String) -> Session? { sessions.first { $0.id == id } }

    /// The series doc for `id` in `year`; with no year, the newest year's.
    func series(id: String?, year: Int? = nil) -> Series? {
        guard let id else { return nil }
        return series.first { $0.id == id && (year == nil || $0.year == year) }
    }

    /// The weekday doc for `year`; with no year, the newest year's.
    func weekday(_ weekday: Weekday, year: Int? = nil) -> WeekdayProgramme? {
        weekdays.first { $0.weekday == weekday && (year == nil || $0.year == year) }
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

    /// Marks `ids` read locally, right now. The truth is written by the
    /// `markNotificationsRead` callable, which can take a cold-start's worth
    /// of seconds to land and come back through the listener; a tap on
    /// "Mark all read" must not wait for that. The next snapshot overwrites
    /// this with whatever the server says, so a failed callable is corrected
    /// by calling `revertRead(ids:)` — or simply by the next real change.
    func markReadOptimistically(ids: [String]) {
        let set = Set(ids)
        notifications = notifications.map { n in
            guard set.contains(n.id), !n.read else { return n }
            var m = n
            m.read = true
            return m
        }
    }

    func revertRead(ids: [String]) {
        let set = Set(ids)
        notifications = notifications.map { n in
            guard set.contains(n.id) else { return n }
            var m = n
            m.read = false
            return m
        }
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

// MARK: - My entries

/// The signed-in member's own entries (`entries where memberId == uid`,
/// ordered by date — the existing composite index), shared by My Card and
/// the Calendar so there is one listener, not two. Mirrors the web's
/// `useMyEntries`.
@MainActor
final class MyEntriesStore: ObservableObject {
    @Published private(set) var entries: [Entry] = []
    @Published private(set) var loading = true
    @Published private(set) var error: SubscriptionError?

    private var listener: ListenerRegistration?
    private var currentUid: String?

    func start(uid: String?) {
        guard uid != currentUid || listener == nil else { return }
        stop()
        currentUid = uid
        guard let uid else {
            entries = []
            loading = false
            return
        }
        loading = true
        listener = FirebaseService.db.collection(Paths.entries)
            .whereField("memberId", isEqualTo: uid)
            .order(by: "date")
            .addSnapshotListener { [weak self] snap, err in
                Task { @MainActor in
                    guard let self else { return }
                    if let err {
                        logSubscriptionFailure("my_entries", err)
                        self.entries = []
                        self.error = SubscriptionError(code: "\((err as NSError).code)", resource: "your dance card")
                    } else {
                        self.entries = snap?.documents.compactMap { try? $0.data(as: Entry.self) } ?? []
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

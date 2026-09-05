//
//  Models.swift
//  `Codable` mirrors of the Firestore document shapes in
//  `shared/src/models.ts` — that file is the single source of truth (plan
//  §3.2, §14.2); this one is a hand-maintained copy. Keep field names and
//  enum raw values identical.
//
//  Timestamps are ISO-8601 **strings** on the wire, not Firestore
//  `Timestamp`s: Cloud Functions convert at the storage boundary and write
//  ISO strings (see `shared/src/primitives.ts` and
//  `firebase/functions/src/entries/lib.ts`), so `String` is the correct Swift
//  type here.
//
//  Decoding is deliberately forgiving about *absent* optional-ish fields
//  (booleans, arrays, nullable refs): a document written before a field
//  existed must still decode rather than poisoning a whole snapshot.
//

import Foundation

// MARK: - Partner references (plan §5.5)

/// `PartnerRef` — a discriminated union on `kind`. `displayName` is
/// denormalised at write time so rosters render without a lookup and without
/// exposing the visitor document.
enum PartnerRef: Codable, Hashable, Identifiable {
    case member(memberId: String, displayName: String)
    case visitor(visitorId: String, displayName: String)

    var displayName: String {
        switch self {
        case let .member(_, name), let .visitor(_, name): return name
        }
    }

    var kind: PartnerKind {
        switch self {
        case .member: return .member
        case .visitor: return .visitor
        }
    }

    var memberId: String? {
        if case let .member(id, _) = self { return id }
        return nil
    }

    var visitorId: String? {
        if case let .visitor(id, _) = self { return id }
        return nil
    }

    /// Stable identity for `ForEach` — the underlying id, namespaced by kind.
    var id: String {
        switch self {
        case let .member(id, _): return "member:\(id)"
        case let .visitor(id, _): return "visitor:\(id)"
        }
    }

    private enum CodingKeys: String, CodingKey {
        case kind, memberId, visitorId, displayName
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try c.decode(PartnerKind.self, forKey: .kind)
        let displayName = try c.decodeIfPresent(String.self, forKey: .displayName) ?? ""
        switch kind {
        case .member:
            self = .member(memberId: try c.decode(String.self, forKey: .memberId), displayName: displayName)
        case .visitor:
            self = .visitor(visitorId: try c.decode(String.self, forKey: .visitorId), displayName: displayName)
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .member(memberId, displayName):
            try c.encode(PartnerKind.member, forKey: .kind)
            try c.encode(memberId, forKey: .memberId)
            try c.encode(displayName, forKey: .displayName)
        case let .visitor(visitorId, displayName):
            try c.encode(PartnerKind.visitor, forKey: .kind)
            try c.encode(visitorId, forKey: .visitorId)
            try c.encode(displayName, forKey: .displayName)
        }
    }
}

/// The bare `{kind, memberId|visitorId}` shape the `setSubstitute` /
/// `addTeamSessionSubstitute` / `removeFromTeam` callables expect — no
/// display name (the server denormalises that itself).
enum PartnerRefInput: Codable, Hashable {
    case member(memberId: String)
    case visitor(visitorId: String)

    var payload: [String: Any] {
        switch self {
        case let .member(memberId): return ["kind": "member", "memberId": memberId]
        case let .visitor(visitorId): return ["kind": "visitor", "visitorId": visitorId]
        }
    }

    init(_ ref: PartnerRef) {
        switch ref {
        case let .member(memberId, _): self = .member(memberId: memberId)
        case let .visitor(visitorId, _): self = .visitor(visitorId: visitorId)
        }
    }
}

// MARK: - members/{memberId} (plan §5.1)

/// Public-to-members profile. `id` **is** the Firebase Auth uid. No email,
/// no device tokens — those live in `MemberPrivate`.
struct Member: Codable, Identifiable, Hashable {
    var id: String
    var firstName: String
    var lastName: String
    var phone: String
    var grade: MemberGrade
    var role: MemberRole
    var active: Bool
    /// Plan §8.1 cohort. Absent on a doc written before the backfill ran —
    /// treated as `club`, which is what the backfill stamps.
    var cohort: MemberCohort
    var lastImportId: String?
    var deactivatedAt: String?
    var erasedAt: String?
    var createdAt: String?
    var updatedAt: String?

    var fullName: String { "\(firstName) \(lastName)" }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        firstName = try c.decodeIfPresent(String.self, forKey: .firstName) ?? ""
        lastName = try c.decodeIfPresent(String.self, forKey: .lastName) ?? ""
        phone = try c.decodeIfPresent(String.self, forKey: .phone) ?? ""
        grade = try c.decodeIfPresent(MemberGrade.self, forKey: .grade) ?? .unknown
        role = try c.decodeIfPresent(MemberRole.self, forKey: .role) ?? .member
        active = try c.decodeIfPresent(Bool.self, forKey: .active) ?? false
        cohort = try c.decodeIfPresent(MemberCohort.self, forKey: .cohort) ?? .club
        lastImportId = try c.decodeIfPresent(String.self, forKey: .lastImportId)
        deactivatedAt = try c.decodeIfPresent(String.self, forKey: .deactivatedAt)
        erasedAt = try c.decodeIfPresent(String.self, forKey: .erasedAt)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
    }

    /// Memberwise init, for previews and tests.
    init(
        id: String,
        firstName: String,
        lastName: String,
        phone: String = "",
        grade: MemberGrade = .unknown,
        role: MemberRole = .member,
        active: Bool = true,
        cohort: MemberCohort = .club
    ) {
        self.id = id
        self.firstName = firstName
        self.lastName = lastName
        self.phone = phone
        self.grade = grade
        self.role = role
        self.active = active
        self.cohort = cohort
    }
}

// MARK: - memberPrivate/{memberId} (plan §5.2)

struct NotificationPrefs: Codable, Hashable {
    var push: Bool
    var email: Bool
    var reminders: Bool
    var matchmakingAlerts: Bool
    var digest: DigestMode
    var reminderDaysBefore: Int

    /// `DEFAULT_NOTIFICATION_PREFS` in `shared/src/models.ts`.
    static let defaults = NotificationPrefs(
        push: true,
        email: true,
        reminders: true,
        matchmakingAlerts: false,
        digest: .immediate,
        reminderDaysBefore: 2
    )

    init(push: Bool, email: Bool, reminders: Bool, matchmakingAlerts: Bool, digest: DigestMode, reminderDaysBefore: Int) {
        self.push = push
        self.email = email
        self.reminders = reminders
        self.matchmakingAlerts = matchmakingAlerts
        self.digest = digest
        self.reminderDaysBefore = reminderDaysBefore
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = NotificationPrefs.defaults
        push = try c.decodeIfPresent(Bool.self, forKey: .push) ?? d.push
        email = try c.decodeIfPresent(Bool.self, forKey: .email) ?? d.email
        reminders = try c.decodeIfPresent(Bool.self, forKey: .reminders) ?? d.reminders
        matchmakingAlerts = try c.decodeIfPresent(Bool.self, forKey: .matchmakingAlerts) ?? d.matchmakingAlerts
        digest = try c.decodeIfPresent(DigestMode.self, forKey: .digest) ?? d.digest
        reminderDaysBefore = try c.decodeIfPresent(Int.self, forKey: .reminderDaysBefore) ?? d.reminderDaysBefore
    }
}

struct RegisteredDevice: Codable, Hashable, Identifiable {
    /// FCM registration token. Never logged, never displayed (plan §3.7).
    var token: String
    var platform: DevicePlatform
    var label: String?
    var lastSeenAt: String?

    var id: String { token }
}

struct MemberPrivate: Codable, Identifiable, Hashable {
    var id: String
    var emailLower: String
    var notificationPrefs: NotificationPrefs
    var devices: [RegisteredDevice]
    /// Maintained by the server; never trust a client-supplied value.
    var hasPassword: Bool
    var lastLoginAt: String?
    /// Plan §21 B1: the member's iCal feed token, when they have one. The
    /// app never builds a URL from it — the feed callables return the URL.
    var icalToken: String?
    var icalTokenCreatedAt: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        emailLower = try c.decodeIfPresent(String.self, forKey: .emailLower) ?? ""
        notificationPrefs = try c.decodeIfPresent(NotificationPrefs.self, forKey: .notificationPrefs) ?? .defaults
        devices = try c.decodeIfPresent([RegisteredDevice].self, forKey: .devices) ?? []
        hasPassword = try c.decodeIfPresent(Bool.self, forKey: .hasPassword) ?? false
        lastLoginAt = try c.decodeIfPresent(String.self, forKey: .lastLoginAt)
        icalToken = try c.decodeIfPresent(String.self, forKey: .icalToken)
        icalTokenCreatedAt = try c.decodeIfPresent(String.self, forKey: .icalTokenCreatedAt)
    }
}

// MARK: - visitors/{visitorId} (plan §5.3)

struct Visitor: Codable, Identifiable, Hashable {
    var id: String
    var displayName: String
    var email: String?
    var phone: String?
    var createdByMemberId: String
    var notes: String?
    var courtesyEmails: Bool
    var lastUsedAt: String?
    /// Set by `importMembers` when a new member's email matched this visitor (§12.5).
    var promotedToMemberId: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        displayName = try c.decodeIfPresent(String.self, forKey: .displayName) ?? ""
        email = try c.decodeIfPresent(String.self, forKey: .email)
        phone = try c.decodeIfPresent(String.self, forKey: .phone)
        createdByMemberId = try c.decodeIfPresent(String.self, forKey: .createdByMemberId) ?? ""
        notes = try c.decodeIfPresent(String.self, forKey: .notes)
        courtesyEmails = try c.decodeIfPresent(Bool.self, forKey: .courtesyEmails) ?? false
        lastUsedAt = try c.decodeIfPresent(String.self, forKey: .lastUsedAt)
        promotedToMemberId = try c.decodeIfPresent(String.self, forKey: .promotedToMemberId)
    }

    init(id: String, displayName: String, createdByMemberId: String = "", courtesyEmails: Bool = false) {
        self.id = id
        self.displayName = displayName
        self.createdByMemberId = createdByMemberId
        self.courtesyEmails = courtesyEmails
    }
}

// MARK: - programmes/{year} and sub-collections (plan §5.4)

struct Programme: Codable, Identifiable, Hashable {
    var id: String
    var year: Int
    var status: ProgrammeStatus
    var importedAt: String?
    var publishedAt: String?
}

struct WeekdayProgramme: Codable, Identifiable, Hashable {
    /// Document id is the `Weekday` raw value.
    var id: String
    var weekday: Weekday
    /// e.g. "Monday Afternoon", "Tuesday (Juniors) Evening".
    var label: String
    var startTime: String
    /// "Players must be seated by" time.
    var seatedByTime: String
    var partnerStewardMemberId: String?
    var notes: String?
    /// The programme year this doc belongs to — **not stored**; stamped by
    /// `ProgrammeStore` on load (plan §21 B3). Weekday doc ids are the
    /// `Weekday` value and so repeat in every year; this disambiguates.
    var year: Int = 0

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        weekday = try c.decode(Weekday.self, forKey: .weekday)
        label = try c.decodeIfPresent(String.self, forKey: .label) ?? weekday.rawValue.capitalized
        startTime = try c.decodeIfPresent(String.self, forKey: .startTime) ?? "13:00"
        seatedByTime = try c.decodeIfPresent(String.self, forKey: .seatedByTime) ?? startTime
        partnerStewardMemberId = try c.decodeIfPresent(String.self, forKey: .partnerStewardMemberId)
        notes = try c.decodeIfPresent(String.self, forKey: .notes)
        year = try c.decodeIfPresent(Int.self, forKey: .year) ?? 0
    }

    init(id: String, weekday: Weekday, label: String, startTime: String, seatedByTime: String, year: Int = 0) {
        self.id = id
        self.weekday = weekday
        self.label = label
        self.startTime = startTime
        self.seatedByTime = seatedByTime
        self.year = year
    }
}

struct BestOf: Codable, Hashable {
    var n: Int
    var m: Int
}

struct Series: Codable, Identifiable, Hashable {
    var id: String
    var weekday: Weekday
    var name: String
    var scoring: ScoringType
    var format: SeriesFormat
    /// "best N from M", when the series uses it.
    var bestOf: BestOf?
    /// Whether a one-week substitute may be recorded for this series.
    var allowSubstitute: Bool
    var eligibilityNote: String?
    var generalNote: String?
    /// Sort order within the weekday.
    var order: Int
    /// Every session id generated for this series, in date order.
    var sessionIds: [String]
    /// Teams format only. Defaults 4/6.
    var teamMin: Int
    var teamMax: Int
    /// The programme year — **not stored**; stamped by `ProgrammeStore` on
    /// load (plan §21 B3). `seriesId` is `${weekday}-${slug(name)}` and can
    /// collide across years, so every series lookup must be year-qualified.
    var year: Int = 0

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        weekday = try c.decode(Weekday.self, forKey: .weekday)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        scoring = try c.decodeIfPresent(ScoringType.self, forKey: .scoring) ?? .scratch
        format = try c.decodeIfPresent(SeriesFormat.self, forKey: .format) ?? .pairs
        bestOf = try c.decodeIfPresent(BestOf.self, forKey: .bestOf)
        allowSubstitute = try c.decodeIfPresent(Bool.self, forKey: .allowSubstitute) ?? false
        eligibilityNote = try c.decodeIfPresent(String.self, forKey: .eligibilityNote)
        generalNote = try c.decodeIfPresent(String.self, forKey: .generalNote)
        order = try c.decodeIfPresent(Int.self, forKey: .order) ?? 0
        sessionIds = try c.decodeIfPresent([String].self, forKey: .sessionIds) ?? []
        teamMin = try c.decodeIfPresent(Int.self, forKey: .teamMin) ?? 4
        teamMax = try c.decodeIfPresent(Int.self, forKey: .teamMax) ?? 6
        year = try c.decodeIfPresent(Int.self, forKey: .year) ?? 0
    }

    init(
        id: String,
        weekday: Weekday,
        name: String,
        scoring: ScoringType = .scratch,
        format: SeriesFormat = .pairs,
        bestOf: BestOf? = nil,
        allowSubstitute: Bool = true,
        order: Int = 0,
        sessionIds: [String] = [],
        teamMin: Int = 4,
        teamMax: Int = 6,
        year: Int = 0
    ) {
        self.id = id
        self.weekday = weekday
        self.name = name
        self.scoring = scoring
        self.format = format
        self.bestOf = bestOf
        self.allowSubstitute = allowSubstitute
        self.order = order
        self.sessionIds = sessionIds
        self.teamMin = teamMin
        self.teamMax = teamMax
        self.year = year
    }
}

struct Session: Codable, Identifiable, Hashable {
    var id: String
    /// NZ-local calendar date, `YYYY-MM-DD`.
    var date: String
    var weekday: Weekday
    /// Null for `holidayBridge` / `noBridge` sessions.
    var seriesId: String?
    var kind: SessionKind
    var title: String
    var partnerRequired: Bool
    /// Denormalised for list rendering without a series lookup.
    var seriesName: String?
    var scoring: ScoringType?
    var format: SeriesFormat?

    /// `bookable` is computed, never stored (plan §5.4).
    func isBookable(today: String = NZDate.today()) -> Bool {
        kind != .noBridge && date >= today
    }

    /// The programme year, from the session's own date (plan §21 B3: never
    /// derived from a `seriesId`, which can collide across years).
    var year: Int { Int(date.prefix(4)) ?? 0 }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        weekday = try c.decode(Weekday.self, forKey: .weekday)
        seriesId = try c.decodeIfPresent(String.self, forKey: .seriesId)
        kind = try c.decodeIfPresent(SessionKind.self, forKey: .kind) ?? .series
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        partnerRequired = try c.decodeIfPresent(Bool.self, forKey: .partnerRequired) ?? true
        seriesName = try c.decodeIfPresent(String.self, forKey: .seriesName)
        scoring = try c.decodeIfPresent(ScoringType.self, forKey: .scoring)
        format = try c.decodeIfPresent(SeriesFormat.self, forKey: .format)
    }

    init(
        id: String,
        date: String,
        weekday: Weekday,
        seriesId: String? = nil,
        kind: SessionKind = .series,
        title: String = "",
        partnerRequired: Bool = true,
        format: SeriesFormat? = nil,
        scoring: ScoringType? = nil
    ) {
        self.id = id
        self.date = date
        self.weekday = weekday
        self.seriesId = seriesId
        self.kind = kind
        self.title = title
        self.partnerRequired = partnerRequired
        self.format = format
        self.scoring = scoring
    }
}

// MARK: - entries/{sessionId}_{memberId} (plan §5.6)

/// One member's dance-card line for one session. See plan §5.6 / §7 for the
/// invariants; `shared/src/pairing.ts` is where the server checks them.
struct Entry: Codable, Identifiable, Hashable {
    /// Server-stamped copy of the owner's cohort (plan §8.1); never sent by a client.
    var cohort: MemberCohort? = nil
    var id: String
    var sessionId: String
    /// Denormalised from the session for range queries.
    var date: String
    var weekday: Weekday
    var seriesId: String?
    var memberId: String
    var status: EntryStatus
    /// The other half of a member/visitor pairing; nil while solo or on a team.
    var partner: PartnerRef?
    /// Shared by all entries of one pairing. Nil for team entries and solo statuses.
    var pairingId: String?
    /// Set for every entry that belongs to a team (Teams series).
    var teamId: String?
    /// True for a session-only team substitute added by the captain.
    var teamSessionOnly: Bool
    /// On the *covered* member's entry: who stands in this week.
    var substitute: PartnerRef?
    /// On the *remaining* member's entry: who their partner sent as a sub.
    var partnerSubstitute: PartnerRef?
    /// On a member-substitute's own entry: the memberId they cover for.
    var isSubstituteFor: String?
    var note: String?
    var createdBy: String?
    /// Set when an admin created/last changed this on behalf of the member.
    var onBehalfBy: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        sessionId = try c.decodeIfPresent(String.self, forKey: .sessionId) ?? ""
        date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        weekday = try c.decode(Weekday.self, forKey: .weekday)
        seriesId = try c.decodeIfPresent(String.self, forKey: .seriesId)
        memberId = try c.decodeIfPresent(String.self, forKey: .memberId) ?? ""
        status = try c.decodeIfPresent(EntryStatus.self, forKey: .status) ?? .cancelled
        partner = try c.decodeIfPresent(PartnerRef.self, forKey: .partner)
        pairingId = try c.decodeIfPresent(String.self, forKey: .pairingId)
        teamId = try c.decodeIfPresent(String.self, forKey: .teamId)
        teamSessionOnly = try c.decodeIfPresent(Bool.self, forKey: .teamSessionOnly) ?? false
        cohort = try c.decodeIfPresent(MemberCohort.self, forKey: .cohort)
        substitute = try c.decodeIfPresent(PartnerRef.self, forKey: .substitute)
        partnerSubstitute = try c.decodeIfPresent(PartnerRef.self, forKey: .partnerSubstitute)
        isSubstituteFor = try c.decodeIfPresent(String.self, forKey: .isSubstituteFor)
        note = try c.decodeIfPresent(String.self, forKey: .note)
        createdBy = try c.decodeIfPresent(String.self, forKey: .createdBy)
        onBehalfBy = try c.decodeIfPresent(String.self, forKey: .onBehalfBy)
    }

    init(
        id: String,
        sessionId: String,
        date: String,
        weekday: Weekday,
        seriesId: String? = nil,
        memberId: String,
        status: EntryStatus,
        partner: PartnerRef? = nil,
        pairingId: String? = nil,
        teamId: String? = nil,
        teamSessionOnly: Bool = false,
        substitute: PartnerRef? = nil,
        partnerSubstitute: PartnerRef? = nil,
        isSubstituteFor: String? = nil,
        note: String? = nil
    ) {
        self.id = id
        self.sessionId = sessionId
        self.date = date
        self.weekday = weekday
        self.seriesId = seriesId
        self.memberId = memberId
        self.status = status
        self.partner = partner
        self.pairingId = pairingId
        self.teamId = teamId
        self.teamSessionOnly = teamSessionOnly
        self.substitute = substitute
        self.partnerSubstitute = partnerSubstitute
        self.isSubstituteFor = isSubstituteFor
        self.note = note
    }

    /// The programme year this entry's session belongs to, from its own date.
    var year: Int { Int(date.prefix(4)) ?? 0 }
}

// MARK: - invites/{inviteId} (plan §5.7)

struct Invite: Codable, Identifiable, Hashable {
    var id: String
    var scope: InviteScope
    /// Absent (and every non-team invite) means `.join`.
    var kind: InviteKind?
    var year: Int
    var sessionIds: [String]
    var seriesId: String?
    /// Set only for `scope == .team`.
    var teamId: String?
    var fromMemberId: String
    var toMemberId: String
    var status: InviteStatus
    var createdBy: String?
    var onBehalfBy: String?
    var respondedAt: String?
    /// ISO instant; 7 days out or the first session's date, whichever is earlier.
    var expiresAt: String
    var message: String?
    var createdAt: String?
    var updatedAt: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        scope = try c.decodeIfPresent(InviteScope.self, forKey: .scope) ?? .session
        kind = try c.decodeIfPresent(InviteKind.self, forKey: .kind)
        year = try c.decodeIfPresent(Int.self, forKey: .year) ?? 0
        sessionIds = try c.decodeIfPresent([String].self, forKey: .sessionIds) ?? []
        seriesId = try c.decodeIfPresent(String.self, forKey: .seriesId)
        teamId = try c.decodeIfPresent(String.self, forKey: .teamId)
        fromMemberId = try c.decodeIfPresent(String.self, forKey: .fromMemberId) ?? ""
        toMemberId = try c.decodeIfPresent(String.self, forKey: .toMemberId) ?? ""
        status = try c.decodeIfPresent(InviteStatus.self, forKey: .status) ?? .pending
        createdBy = try c.decodeIfPresent(String.self, forKey: .createdBy)
        onBehalfBy = try c.decodeIfPresent(String.self, forKey: .onBehalfBy)
        respondedAt = try c.decodeIfPresent(String.self, forKey: .respondedAt)
        expiresAt = try c.decodeIfPresent(String.self, forKey: .expiresAt) ?? ""
        message = try c.decodeIfPresent(String.self, forKey: .message)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
    }
}

// MARK: - notifications/{notificationId} (plan §5.8)

struct AppNotification: Codable, Identifiable, Hashable {
    var id: String
    var memberId: String
    var type: NotificationType
    var title: String
    var body: String
    /// Deep-link payload, e.g. `{ sessionId, year }` or `{ inviteId }`.
    var data: [String: String]
    var channelsSent: [NotificationChannel]
    var read: Bool
    var readAt: String?
    var createdAt: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        memberId = try c.decodeIfPresent(String.self, forKey: .memberId) ?? ""
        type = try c.decodeIfPresent(NotificationType.self, forKey: .type) ?? .unrecognised
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        body = try c.decodeIfPresent(String.self, forKey: .body) ?? ""
        data = try c.decodeIfPresent([String: String].self, forKey: .data) ?? [:]
        channelsSent = try c.decodeIfPresent([NotificationChannel].self, forKey: .channelsSent) ?? []
        read = try c.decodeIfPresent(Bool.self, forKey: .read) ?? false
        readAt = try c.decodeIfPresent(String.self, forKey: .readAt)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
    }
}

// MARK: - teams/{teamId} (plan §5.9, §12A)

struct TeamMemberEntry: Codable, Hashable, Identifiable {
    var ref: PartnerRef
    var joinedAt: String?

    var id: String { ref.id }
}

struct Team: Codable, Identifiable, Hashable {
    /// Server-stamped copy of the captain's cohort (plan §8.1).
    var cohort: MemberCohort? = nil
    var id: String
    var year: Int
    var seriesId: String
    /// Defaults to "<captain surname> team" server-side.
    var name: String
    var captainMemberId: String
    /// Includes the captain; members or visitors.
    var members: [TeamMemberEntry]
    var status: TeamStatus
    /// Visitor session-only substitutes, keyed by `sessionId` (plan §5.9).
    /// A *member* substitute is a `teamSessionOnly` entry instead (I9) and
    /// never appears here.
    var sessionVisitors: [String: [PartnerRef]]?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        year = try c.decodeIfPresent(Int.self, forKey: .year) ?? 0
        seriesId = try c.decodeIfPresent(String.self, forKey: .seriesId) ?? ""
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        captainMemberId = try c.decodeIfPresent(String.self, forKey: .captainMemberId) ?? ""
        members = try c.decodeIfPresent([TeamMemberEntry].self, forKey: .members) ?? []
        status = try c.decodeIfPresent(TeamStatus.self, forKey: .status) ?? .forming
        sessionVisitors = try c.decodeIfPresent([String: [PartnerRef]].self, forKey: .sessionVisitors)
        cohort = try c.decodeIfPresent(MemberCohort.self, forKey: .cohort)
    }

    init(
        id: String,
        year: Int = 0,
        seriesId: String,
        name: String,
        captainMemberId: String,
        members: [TeamMemberEntry] = [],
        status: TeamStatus = .forming,
        sessionVisitors: [String: [PartnerRef]]? = nil
    ) {
        self.id = id
        self.year = year
        self.seriesId = seriesId
        self.name = name
        self.captainMemberId = captainMemberId
        self.members = members
        self.status = status
        self.sessionVisitors = sessionVisitors
    }

    /// memberIds on the roster (visitors excluded).
    var rosterMemberIds: Set<String> {
        Set(members.compactMap { $0.ref.memberId })
    }
}

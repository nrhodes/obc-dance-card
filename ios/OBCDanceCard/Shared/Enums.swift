//
//  Enums.swift
//  Closed vocabularies, mirrored by hand from `shared/src/enums.ts` — the
//  single source of truth (plan §3.2). Raw values are byte-for-byte identical
//  to the TypeScript const tuples; changing one here without changing the
//  other silently breaks decoding of live documents.
//
//  Every enum is `String`-backed and decodes leniently where the server may
//  add a value later (see `NotificationType`), so an unknown value from a
//  newer backend degrades to "unknown" rather than failing the whole
//  snapshot.
//

import Foundation

/// `MEMBER_GRADES`
/// App-Store-review cohort partition (plan §8.1, decided 2026-09-05):
/// `club` is every real member; `review` only the fake accounts provisioned
/// for Apple's reviewers. Rules require every roster-style read to be scoped
/// to the caller's own cohort, so the directory, teams and session-entries
/// listeners all filter on it. Mirrors `MEMBER_COHORTS` in `shared/src/enums.ts`.
enum MemberCohort: String, Codable, Hashable {
    case club, review
}

enum MemberGrade: String, Codable, CaseIterable, Hashable {
    case open = "Open"
    case intermediate = "Intermediate"
    case junior = "Junior"
    case unknown = "Unknown"
}

/// `MEMBER_ROLES`
enum MemberRole: String, Codable, Hashable {
    case member
    case admin
}

/// `WEEKDAYS` — the club runs Monday–Friday only.
enum Weekday: String, Codable, CaseIterable, Hashable {
    case monday, tuesday, wednesday, thursday, friday

    /// Short tab label, mirroring `web/src/lib/format.ts#shortWeekdayLabel`.
    var shortLabel: String {
        switch self {
        case .monday: return "Mon"
        case .tuesday: return "Tue"
        case .wednesday: return "Wed"
        case .thursday: return "Thu"
        case .friday: return "Fri"
        }
    }
}

/// `SCORING_TYPES`
enum ScoringType: String, Codable, Hashable {
    case scratch = "Scr"
    case handicap = "Hcp"
}

/// `SERIES_FORMATS`
enum SeriesFormat: String, Codable, Hashable {
    case pairs = "Pairs"
    case teams = "Teams"
    case individual = "Individual"
}

/// `SESSION_KINDS`
enum SessionKind: String, Codable, Hashable {
    case series
    case holidayBridge
    case noBridge
}

/// `PARTNER_KINDS`
enum PartnerKind: String, Codable, Hashable {
    case member
    case visitor
}

/// `ENTRY_STATUSES` — see `shared/src/enums.ts` for what each one means.
enum EntryStatus: String, Codable, Hashable {
    case confirmed
    case lookingForPartner = "looking_for_partner"
    case available
    /// Plan §21 B2: a solo "don't offer me this session" marker. Never on
    /// the noticeboard, never alerted on, never a row on the card — but it
    /// still occupies the member's slot server-side like a booking does.
    case unavailable
    case substituted
    case cancelled

    /// `ACTIVE_ENTRY_STATUSES`: statuses that occupy a place on the member's
    /// *card display*. Deliberately excludes `unavailable` (a marker, not a
    /// booking). Server-side "is this member free" checks use the wider
    /// "any non-cancelled entry" rule instead.
    static let active: Set<EntryStatus> = [.confirmed, .lookingForPartner, .available, .substituted]

    /// `SOLO_ENTRY_STATUSES`: the three unpaired statuses (I6).
    static let solo: Set<EntryStatus> = [.lookingForPartner, .available, .unavailable]

    /// `NOTICEBOARD_STATUSES`: statuses visible on the public noticeboard.
    static let noticeboard: [EntryStatus] = [.lookingForPartner, .available]
}

/// The statuses a member can set on themselves (`setSoloStatus`).
enum SoloStatus: String, Codable, Hashable, CaseIterable {
    case lookingForPartner = "looking_for_partner"
    case available
    case unavailable

    var entryStatus: EntryStatus {
        switch self {
        case .lookingForPartner: return .lookingForPartner
        case .available: return .available
        case .unavailable: return .unavailable
        }
    }
}

/// `setBulkSoloStatus`'s status argument (plan §21 B2): the two markers, or
/// `clear` to remove either (entries flip to `cancelled`; never deleted).
enum BulkAvailabilityStatus: String, Codable, Hashable, CaseIterable {
    case available, unavailable, clear
}

/// `INVITE_STATUSES`
enum InviteStatus: String, Codable, Hashable {
    case pending, accepted, declined, cancelled, expired
}

/// `INVITE_SCOPES`
enum InviteScope: String, Codable, Hashable {
    case session, series, team
}

/// `INVITE_KINDS` — absent means `.join` (plan §5.7).
enum InviteKind: String, Codable, Hashable {
    case join, captaincy
}

/// `PROGRAMME_STATUSES`
enum ProgrammeStatus: String, Codable, Hashable {
    case draft, published
}

/// `TEAM_STATUSES`
enum TeamStatus: String, Codable, Hashable {
    case forming, active, disbanded
}

/// `NOTIFICATION_CHANNELS`
enum NotificationChannel: String, Codable, Hashable {
    case inapp, push, email, sms
}

/// `DIGEST_MODES`
enum DigestMode: String, Codable, Hashable {
    case immediate, daily
}

/// `RegisteredDevice.platform`
enum DevicePlatform: String, Codable, Hashable {
    case ios, web
}

/// Which side of a pairing a substitute stands in for (`SetSubstituteInput.coverFor`).
enum CoverFor: String, Codable, Hashable {
    case selfMember = "self"
    case partner
}

/// `NOTIFICATION_TYPES`. Decoded leniently: the server owns this list and may
/// grow it, and a notification whose type this build doesn't recognise must
/// still render its title/body rather than break the whole feed.
enum NotificationType: String, Codable, Hashable {
    case inviteReceived = "invite_received"
    case inviteAccepted = "invite_accepted"
    case inviteDeclined = "invite_declined"
    case inviteCancelled = "invite_cancelled"
    case inviteExpired = "invite_expired"
    case claimed
    case partnerCancelled = "partner_cancelled"
    case substituteArranged = "substitute_arranged"
    case substituteCleared = "substitute_cleared"
    case matchmakingAlert = "matchmaking_alert"
    case sessionReminder = "session_reminder"
    case onBehalfAction = "on_behalf_action"
    case teamInviteReceived = "team_invite_received"
    case teamMemberJoined = "team_member_joined"
    case teamMemberDeclined = "team_member_declined"
    case teamMemberLeft = "team_member_left"
    case teamMemberAbsent = "team_member_absent"
    case teamRemoved = "team_removed"
    case teamCaptaincyOffered = "team_captaincy_offered"
    case teamCaptaincyTransferred = "team_captaincy_transferred"
    case teamDisbanded = "team_disbanded"
    case broadcast
    case security
    case visitorPromoted = "visitor_promoted"
    case programmeChanged = "programme_changed"
    /// Not a server value — the fallback for a type this build predates.
    case unrecognised = "__unrecognised__"

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = NotificationType(rawValue: raw) ?? .unrecognised
    }
}

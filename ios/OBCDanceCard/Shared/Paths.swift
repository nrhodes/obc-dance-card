//
//  Paths.swift
//  Canonical Firestore collection/document paths — the Swift mirror of
//  `shared/src/paths.ts`. Using these keeps path strings identical between
//  the security rules, Cloud Functions, and both clients.
//
//  Two families (plan §21 B14.2), exactly as in the TypeScript:
//
//   * `ClubPaths` — everything a club owns: members, programme, entries,
//     invites, teams, visitors. Reached through `Club.current`.
//   * `Paths` — what belongs to the person whatever clubs they are in:
//     `userPrivate` and notifications.
//
//  Stage 1b (plan §21 B14.8) moved the data: club-owned collections live
//  under `clubs/{clubId}/…` and `memberPrivate` became `userPrivate`.
//
//  Only the collections a member client actually reads are listed. The
//  server-only ones (`auditLog`, `emailCodes`, `rateLimits`, `imports`,
//  `integrity`) are deliberately absent: rules deny them to every client, so
//  a path builder for them here would only invite an attempt.
//

import Foundation

/// Stable, URL-safe club slug. Chosen at club creation and never renamed.
typealias ClubId = String

/// Path builders for one club's data.
struct ClubPaths: Equatable {
    let clubId: ClubId

    /// Everything a club owns lives under `clubs/{clubId}/`.
    private var root: String { "clubs/\(clubId)/" }

    var members: String { "\(root)members" }
    func member(_ memberId: String) -> String { "\(root)members/\(memberId)" }

    var visitors: String { "\(root)visitors" }
    func visitor(_ visitorId: String) -> String { "\(root)visitors/\(visitorId)" }

    var teams: String { "\(root)teams" }
    func team(_ teamId: String) -> String { "\(root)teams/\(teamId)" }

    var programmes: String { "\(root)programmes" }
    func programme(_ year: Int) -> String { "\(root)programmes/\(year)" }

    func weekdays(_ year: Int) -> String { "\(root)programmes/\(year)/weekdays" }
    func series(_ year: Int) -> String { "\(root)programmes/\(year)/series" }
    func sessions(_ year: Int) -> String { "\(root)programmes/\(year)/sessions" }

    var entries: String { "\(root)entries" }
    func entry(_ entryId: String) -> String { "\(root)entries/\(entryId)" }

    var invites: String { "\(root)invites" }
    func invite(_ inviteId: String) -> String { "\(root)invites/\(inviteId)" }

    /// Adds this club's id to a callable payload, unless the caller already
    /// named a club. Club-scoped callables act in the club they are told to
    /// (`clubId` in `shared/src/schemas.ts`).
    func stamping(_ payload: [String: Any]) -> [String: Any] {
        var out = payload
        if out["clubId"] == nil { out["clubId"] = clubId }
        return out
    }
}

/// Which club the app is showing.
///
/// Stage 1a: there is one club and no way to choose another, so `current` is
/// a constant. Stage 3 resolves it from the signed-in person's memberships
/// and stage 4 adds the switcher; the stores will then re-subscribe when it
/// changes.
enum Club {
    /// The one club that exists today — `DEFAULT_CLUB_ID` in `shared/src/paths.ts`.
    static let defaultClubId: ClubId = "orewa"

    static let current = ClubPaths(clubId: defaultClubId)
}

/// Person-level paths: not owned by any one club.
enum Paths {
    /// The person's private record (login email, devices, prefs, iCal token).
    /// Was `memberPrivate/{memberId}` before stage 1b; the Swift model keeps
    /// the name `MemberPrivate`.
    static let userPrivates = "userPrivate"
    static func userPrivate(_ uid: String) -> String { "userPrivate/\(uid)" }

    static let notifications = "notifications"
    static func notification(_ id: String) -> String { "notifications/\(id)" }
}

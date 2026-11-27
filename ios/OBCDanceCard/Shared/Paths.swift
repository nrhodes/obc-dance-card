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
//     `memberPrivate` and notifications.
//
//  **Stage 1a (plan §21 B14.8): the club is threaded through the code, but
//  the data has not moved.** `ClubPaths` deliberately ignores `clubId` when
//  spelling a path, so every builder still returns today's top-level
//  location. Stage 1b changes `root` below to `clubs/{clubId}/`, in step with
//  `shared/src/paths.ts`, the data migration and the rules.
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

    /// Stage 1b: `"clubs/\(clubId)/"`. Until then the data is top-level.
    private var root: String { "" }

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
    static let memberPrivates = "memberPrivate"
    static func memberPrivate(_ memberId: String) -> String { "memberPrivate/\(memberId)" }

    static let notifications = "notifications"
    static func notification(_ id: String) -> String { "notifications/\(id)" }
}

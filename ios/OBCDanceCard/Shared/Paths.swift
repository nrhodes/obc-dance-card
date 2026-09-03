//
//  Paths.swift
//  Canonical Firestore collection/document paths — the Swift mirror of
//  `shared/src/paths.ts`. Using these keeps path strings identical between
//  the security rules, Cloud Functions, and both clients.
//
//  Only the collections a member client actually reads are listed. The
//  server-only ones (`auditLog`, `emailCodes`, `rateLimits`, `imports`,
//  `integrity`) are deliberately absent: rules deny them to every client, so
//  a path builder for them here would only invite an attempt.
//

import Foundation

enum Paths {
    static let members = "members"
    static func member(_ memberId: String) -> String { "members/\(memberId)" }

    static let memberPrivates = "memberPrivate"
    static func memberPrivate(_ memberId: String) -> String { "memberPrivate/\(memberId)" }

    static let visitors = "visitors"
    static func visitor(_ visitorId: String) -> String { "visitors/\(visitorId)" }

    static let teams = "teams"
    static func team(_ teamId: String) -> String { "teams/\(teamId)" }

    static let programmes = "programmes"
    static func programme(_ year: Int) -> String { "programmes/\(year)" }

    static func weekdays(_ year: Int) -> String { "programmes/\(year)/weekdays" }
    static func series(_ year: Int) -> String { "programmes/\(year)/series" }
    static func sessions(_ year: Int) -> String { "programmes/\(year)/sessions" }

    static let entries = "entries"
    static func entry(_ entryId: String) -> String { "entries/\(entryId)" }

    static let invites = "invites"
    static func invite(_ inviteId: String) -> String { "invites/\(inviteId)" }

    static let notifications = "notifications"
    static func notification(_ id: String) -> String { "notifications/\(id)" }
}

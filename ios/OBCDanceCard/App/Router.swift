//
//  Router.swift
//  Tab selection + navigation destinations, and the deep-link resolution a
//  tapped push notification feeds into it.
//
//  `DeepLink.resolve` mirrors `web/src/push/deepLink.ts` and the in-app feed's
//  `deepLinkFor`, so a given `notifications/{id}.data` payload opens the same
//  place on both clients. Notification payloads carry **ids only** (plan
//  §14.2) — never a name, an email, or anything else worth reading off a lock
//  screen.
//

import Foundation
import SwiftUI

enum DeepLink: Equatable, Hashable {
    case session(year: Int, sessionId: String)
    case invites
    case notifications

    /// Maps a push/notification `data` payload to a destination. A tapped OS
    /// notification always opens *something*, so an unrecognised payload
    /// lands on the notifications feed rather than doing nothing.
    static func resolve(_ data: [String: Any]) -> DeepLink {
        let sessionId = data["sessionId"] as? String
        let yearString = data["year"] as? String ?? (data["year"] as? Int).map(String.init)
        if let sessionId, let yearString, let year = Int(yearString), !sessionId.isEmpty {
            return .session(year: year, sessionId: sessionId)
        }
        if let inviteId = data["inviteId"] as? String, !inviteId.isEmpty {
            return .invites
        }
        return .notifications
    }
}

/// The five tabs. Invites and notifications share `inbox` (see `InboxView`)
/// so the bar never folds anything under "More".
enum Tab: Hashable {
    case card, calendar, programme, inbox, profile
}

/// Navigation destinations pushed onto a tab's stack.
enum Route: Hashable {
    case session(year: Int, sessionId: String)
    case visitors
    case help
    case privacy
}

@MainActor
final class Router: ObservableObject {
    @Published var selectedTab: Tab = .card
    @Published var inboxSegment: InboxSegment = .invites
    @Published var cardPath = NavigationPath()
    @Published var calendarPath = NavigationPath()
    @Published var programmePath = NavigationPath()
    @Published var inboxPath = NavigationPath()
    @Published var profilePath = NavigationPath()

    func open(_ link: DeepLink) {
        switch link {
        case let .session(year, sessionId):
            selectedTab = .card
            cardPath.append(Route.session(year: year, sessionId: sessionId))
        case .invites:
            selectedTab = .inbox
            inboxSegment = .invites
        case .notifications:
            selectedTab = .inbox
            inboxSegment = .alerts
        }
    }

    /// Opens a session from anywhere that already knows the ids, on the tab
    /// it was tapped from.
    func openSession(year: Int, sessionId: String, from tab: Tab) {
        let route = Route.session(year: year, sessionId: sessionId)
        switch tab {
        case .calendar: calendarPath.append(route)
        case .programme: programmePath.append(route)
        case .inbox: inboxPath.append(route)
        case .profile: profilePath.append(route)
        case .card: cardPath.append(route)
        }
    }
}

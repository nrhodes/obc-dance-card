//
//  MainTabView.swift
//  The five member tabs (plan §14.1's member screen list, minus the web-only
//  admin section): My card, Programme, Invites, Notifications, Profile.
//  Session, Team, Visitors and the noticeboard are reached from within them,
//  the same way the web app routes to them.
//

import SwiftUI

struct MainTabView: View {
    @EnvironmentObject private var router: Router
    @EnvironmentObject private var invites: InvitesStore
    @EnvironmentObject private var notifications: NotificationsStore

    var body: some View {
        TabView(selection: $router.selectedTab) {
            NavigationStack(path: $router.cardPath) {
                CardView()
                    .navigationDestination(for: Route.self) { destination($0) }
            }
            .tabItem { Label("My card", systemImage: "list.bullet.rectangle.portrait") }
            .tag(Tab.card)

            NavigationStack(path: $router.programmePath) {
                ProgrammeView()
                    .navigationDestination(for: Route.self) { destination($0) }
            }
            .tabItem { Label("Programme", systemImage: "calendar") }
            .tag(Tab.programme)

            NavigationStack {
                InvitesView()
            }
            .tabItem { Label("Invites", systemImage: "envelope") }
            .badge(invites.pendingCount)
            .tag(Tab.invites)

            NavigationStack(path: $router.notificationsPath) {
                NotificationsView()
                    .navigationDestination(for: Route.self) { destination($0) }
            }
            .tabItem { Label("Alerts", systemImage: "bell") }
            .badge(notifications.unreadCount)
            .tag(Tab.notifications)

            NavigationStack(path: $router.profilePath) {
                ProfileView()
                    .navigationDestination(for: Route.self) { destination($0) }
            }
            .tabItem { Label("Profile", systemImage: "person.crop.circle") }
            .tag(Tab.profile)
        }
    }

    @ViewBuilder
    private func destination(_ route: Route) -> some View {
        switch route {
        case let .session(year, sessionId):
            SessionView(year: year, sessionId: sessionId)
        case .visitors:
            VisitorsView()
        case .help:
            HelpView()
        case .privacy:
            PrivacyView()
        }
    }
}

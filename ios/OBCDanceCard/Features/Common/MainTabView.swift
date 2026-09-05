//
//  MainTabView.swift
//  The five member tabs. The web app's member nav is My card, Programme,
//  Calendar, Invites, Notifications, Profile (plan §14.1 + §21 B4); an iPhone
//  tab bar folds a sixth item under "More", so Invites and Notifications
//  share the Inbox tab (see `InboxView`). Session, Team, Visitors and the
//  noticeboard are reached from within these, as on the web.
//

import SwiftUI

struct MainTabView: View {
    @EnvironmentObject private var router: Router
    @EnvironmentObject private var invites: InvitesStore
    @EnvironmentObject private var notifications: NotificationsStore
    @EnvironmentObject private var auth: AuthModel
    @EnvironmentObject private var push: PushManager

    @State private var showSoftAsk = false

    /// Everything the soft-ask decision depends on, so one `onChange` covers
    /// the member doc arriving, the OS status being read, and "Not now".
    private var softAskWanted: Bool {
        guard let memberPrivate = auth.memberPrivate else { return false }
        return PushSoftAsk.shouldOffer(
            authorization: push.authorization,
            prefsAllowPush: memberPrivate.notificationPrefs.push,
            dismissed: push.softAskDismissed
        )
    }

    var body: some View {
        tabs
            .onChange(of: softAskWanted, initial: true) { _, wanted in
                if wanted { showSoftAsk = true }
            }
            .sheet(isPresented: $showSoftAsk) {
                PushSoftAskView()
            }
    }

    private var tabs: some View {
        TabView(selection: $router.selectedTab) {
            NavigationStack(path: $router.cardPath) {
                CardView()
                    .navigationDestination(for: Route.self) { destination($0) }
            }
            .tabItem { Label("My card", systemImage: "list.bullet.rectangle.portrait") }
            .tag(Tab.card)

            NavigationStack(path: $router.calendarPath) {
                CalendarView()
                    .navigationDestination(for: Route.self) { destination($0) }
            }
            .tabItem { Label("Calendar", systemImage: "calendar") }
            .tag(Tab.calendar)

            NavigationStack(path: $router.programmePath) {
                ProgrammeView()
                    .navigationDestination(for: Route.self) { destination($0) }
            }
            .tabItem { Label("Programme", systemImage: "list.bullet.clipboard") }
            .tag(Tab.programme)

            NavigationStack(path: $router.inboxPath) {
                InboxView()
                    .navigationDestination(for: Route.self) { destination($0) }
            }
            .tabItem { Label("Inbox", systemImage: "tray") }
            .badge(invites.pendingCount + notifications.unreadCount)
            .tag(Tab.inbox)

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

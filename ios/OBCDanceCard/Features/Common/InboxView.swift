//
//  InboxView.swift
//  Invites and Notifications under one tab. The web app has six member
//  destinations (My card, Programme, Calendar, Invites, Notifications,
//  Profile); an iPhone tab bar shows five before folding the rest under
//  "More", which is exactly the kind of hidden navigation this app's members
//  should never have to discover. Invites and alerts are the two things that
//  arrive *at* a member, so they share an Inbox with a segmented control and a
//  combined badge. Deep links pick the segment.
//

import SwiftUI

enum InboxSegment: String, CaseIterable, Identifiable {
    case invites = "Invites"
    case alerts = "Alerts"
    var id: String { rawValue }
}

struct InboxView: View {
    @EnvironmentObject private var router: Router
    @EnvironmentObject private var invites: InvitesStore
    @EnvironmentObject private var notifications: NotificationsStore

    var body: some View {
        VStack(spacing: 0) {
            Picker("Inbox", selection: $router.inboxSegment) {
                ForEach(InboxSegment.allCases) { segment in
                    Text(label(for: segment)).tag(segment)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.bottom, 8)

            switch router.inboxSegment {
            case .invites: InvitesView()
            case .alerts: NotificationsView()
            }
        }
        .navigationTitle("Inbox")
    }

    private func label(for segment: InboxSegment) -> String {
        switch segment {
        case .invites:
            return invites.pendingCount > 0 ? "Invites (\(invites.pendingCount))" : "Invites"
        case .alerts:
            return notifications.unreadCount > 0 ? "Alerts (\(notifications.unreadCount))" : "Alerts"
        }
    }
}

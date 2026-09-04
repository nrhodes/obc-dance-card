//
//  NotificationsView.swift
//  Notifications feed (plan §11) — the counterpart of
//  `web/src/screens/NotificationsScreen.tsx`. Newest 50; unread ones are
//  marked; tapping one marks it read via `markNotificationsRead` and follows
//  its `data` deep link, resolved by the same `DeepLink.resolve` a tapped
//  push uses so both routes agree.
//
//  Marking read is the *one* client Firestore write the plan allows — and
//  even that goes through a callable here (plan §3.3, §9.2).
//

import SwiftUI

struct NotificationsView: View {
    @EnvironmentObject private var notifications: NotificationsStore
    @EnvironmentObject private var router: Router

    var body: some View {
        List {
            if let error = notifications.error {
                Section { Text(error.message).foregroundStyle(.secondary) }
            }

            Section {
                if notifications.loading {
                    ProgressView()
                } else if notifications.notifications.isEmpty {
                    Text("Nothing here yet.").foregroundStyle(.secondary)
                }
                ForEach(notifications.notifications) { notification in
                    Button {
                        Task { await open(notification) }
                    } label: {
                        row(notification)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .navigationTitle("Notifications")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Mark all read") { Task { await markAllRead() } }
                    .disabled(notifications.unreadCount == 0)
            }
        }
    }

    @ViewBuilder
    private func row(_ notification: AppNotification) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(notification.read ? Color.clear : Color.accentColor)
                .frame(width: 8, height: 8)
                .padding(.top, 6)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(notification.title)
                    .font(.body.weight(notification.read ? .regular : .semibold))
                Text(notification.body).font(.subheadline)
                if let createdAt = notification.createdAt {
                    Text(Fmt.dateTime(createdAt)).font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(notification.read
                            ? "\(notification.title). \(notification.body)"
                            : "Unread. \(notification.title). \(notification.body)")
    }

    private func open(_ notification: AppNotification) async {
        if !notification.read {
            notifications.markReadOptimistically(ids: [notification.id])
            do {
                try await Api.markNotificationsRead(ids: [notification.id])
            } catch {
                notifications.revertRead(ids: [notification.id])
            }
        }
        // The in-app feed has somewhere sensible to already be, so — unlike a
        // tapped OS notification — a payload with no link does nothing.
        let link = DeepLink.resolve(notification.data)
        if case let .session(year, sessionId) = link {
            router.openSession(year: year, sessionId: sessionId, from: .notifications)
        } else if case .invites = link {
            router.selectedTab = .invites
        }
    }

    private func markAllRead() async {
        let ids = notifications.notifications.filter { !$0.read }.map(\.id)
        guard !ids.isEmpty else { return }
        // Clear the dots and the tab badge immediately; the callable
        // confirms in the background and the listener reconciles.
        notifications.markReadOptimistically(ids: ids)
        do {
            try await Api.markNotificationsRead(ids: ids)
        } catch {
            notifications.revertRead(ids: ids)
        }
    }
}

//
//  PushSoftAsk.swift
//  The "soft ask" for notifications (decided 2026-09-05): on the first
//  signed-in launch the app explains, in its own words, what notifications
//  are for and offers one button. Only that button triggers the real iOS
//  permission dialog — which iOS shows exactly once per install — so a
//  member who taps "Not now" burns nothing and can still turn notifications
//  on later from Profile ("Notifications on this device").
//

import SwiftUI
import UserNotifications

enum PushSoftAsk {
    /// Whether to put the soft ask in front of the member right now.
    ///
    /// Only when there is still a decision to make: iOS hasn't been asked
    /// yet, the member-wide "Push notifications" preference is on (otherwise
    /// the answer is already "no"), and the member hasn't already said "Not
    /// now" on this install.
    static func shouldOffer(
        authorization: UNAuthorizationStatus,
        prefsAllowPush: Bool,
        dismissed: Bool
    ) -> Bool {
        authorization == .notDetermined && prefsAllowPush && !dismissed
    }
}

struct PushSoftAskView: View {
    @EnvironmentObject private var push: PushManager
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "bell.badge")
                .font(.system(size: 56))
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            Text("Stay in the loop")
                .font(.title.bold())
            Text("Get a notification on this phone when a partner responds, cancels, or invites you.")
                .font(.body)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .padding(.horizontal)
            Spacer()
            Button {
                Task {
                    await push.enable()
                    dismiss()
                }
            } label: {
                Text(push.busy ? "Turning on…" : "Turn on notifications").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(push.busy)
            Button("Not now") {
                push.dismissSoftAsk()
                dismiss()
            }
            .disabled(push.busy)
            Text("You can change this any time in Profile.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(24)
        .interactiveDismissDisabled(push.busy)
    }
}

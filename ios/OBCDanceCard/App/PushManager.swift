//
//  PushManager.swift
//  FCM registration and notification handling (plan §11, §14.2; the Swift
//  counterpart of `web/src/push/usePush.ts`).
//
//  Rules this file exists to keep:
//   * The iOS permission dialog is only ever triggered by a member's own tap:
//     the first-launch soft ask (`PushSoftAskView`) or Profile's "Turn on
//     notifications on this device". iOS shows that dialog once per install,
//     so an unexpected one gets a reflexive "Don't Allow" that only Settings
//     can undo; the soft ask explains first, and "Not now" costs nothing.
//   * `registerDevice { token, platform: "ios", label }` on every token
//     refresh; `unregisterDevice` on sign-out (plan §14.2).
//   * A device token is a secret-adjacent value: never logged, never shown.
//   * Deep links come from the payload's ids only, via `DeepLink.resolve`.
//
//  Deprecation warnings on `Messaging.token()` / `deleteToken()` are
//  deliberate. Firebase Messaging 12.18 is moving from registration tokens to
//  Firebase-Installation-ID registration (`register()`/`unregister()`), but
//  push here is token-addressed end to end — the server sends to
//  `memberPrivate.devices[].token`, and the web client registers tokens too —
//  so iOS switching alone would leave it unreachable. The old calls still
//  work (the new model is opt-in via an Info.plist key we don't set). The
//  cross-client migration is plan §21 B6; leave the warnings visible until
//  then rather than hiding them.
//

import FirebaseMessaging
import Foundation
import UIKit
import UserNotifications

@MainActor
final class PushManager: NSObject, ObservableObject {
    enum State: Equatable {
        /// Not asked yet — the Profile toggle is off and tapping it prompts.
        case prompt
        /// The member (or a previous install) said no. Only Settings can undo it.
        case denied
        /// A token for this device is registered.
        case enabled
        case error(String)
    }

    private static let tokenKey = "obc.pushToken"
    private static let softAskDismissedKey = "obc.pushSoftAskDismissed"

    @Published private(set) var state: State = .prompt
    @Published private(set) var busy = false
    /// The OS-level answer, as last read. `.notDetermined` until iOS has
    /// been asked; the soft ask is only offered while it is.
    @Published private(set) var authorization: UNAuthorizationStatus = .notDetermined
    /// The member tapped "Not now" on the soft ask on this install.
    @Published private(set) var softAskDismissed: Bool =
        UserDefaults.standard.bool(forKey: PushManager.softAskDismissedKey)

    func dismissSoftAsk() {
        softAskDismissed = true
        UserDefaults.standard.set(true, forKey: Self.softAskDismissedKey)
    }

    /// Set by the app so a tapped notification can be routed once the UI is up.
    var onDeepLink: ((DeepLink) -> Void)?

    /// Last token FCM issued for this device, if any.
    private var storedToken: String? {
        get { UserDefaults.standard.string(forKey: Self.tokenKey) }
        set {
            if let newValue { UserDefaults.standard.set(newValue, forKey: Self.tokenKey) }
            else { UserDefaults.standard.removeObject(forKey: Self.tokenKey) }
        }
    }

    func configure() {
        UNUserNotificationCenter.current().delegate = self
        Messaging.messaging().delegate = self
        Task { await refreshState() }
    }

    /// Reads the current OS-level permission without prompting.
    func refreshState() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        authorization = settings.authorizationStatus
        switch settings.authorizationStatus {
        case .denied:
            state = .denied
        case .authorized, .provisional, .ephemeral:
            state = storedToken == nil ? .prompt : .enabled
        case .notDetermined:
            state = .prompt
        @unknown default:
            state = .prompt
        }
    }

    /// The one place permission is ever requested (from the Profile toggle).
    func enable() async {
        busy = true
        defer { busy = false }
        do {
            let granted = try await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .badge, .sound])
            guard granted else {
                await refreshState()
                return
            }
            UIApplication.shared.registerForRemoteNotifications()
            guard let token = try await Messaging.messaging().token() as String? else {
                state = .error("No push token was issued.")
                return
            }
            try await register(token: token)
            state = .enabled
        } catch {
            state = .error(ErrorMapper.genericMessage(error))
        }
    }

    /// Turns push off for *this device* only. The server prunes dead tokens
    /// itself (plan §11), so this is best-effort.
    func disable() async {
        busy = true
        defer { busy = false }
        if let token = storedToken {
            try? await Api.unregisterDevice(token: token)
        }
        try? await Messaging.messaging().deleteToken()
        storedToken = nil
        await refreshState()
    }

    /// Sign-out hook: forget this device's token server-side so the next
    /// person to sign in on this handset never receives the last one's
    /// notifications.
    func unregisterOnSignOut() async {
        guard let token = storedToken else { return }
        try? await Api.unregisterDevice(token: token)
        storedToken = nil
        await refreshState()
    }

    /// Registers `token` and retires the previous one if FCM rotated it.
    private func register(token: String) async throws {
        let previous = storedToken
        try await Api.registerDevice(token: token, label: Self.deviceLabel())
        if let previous, previous != token {
            try? await Api.unregisterDevice(token: previous)
        }
        storedToken = token
    }

    /// A short, human label for `memberPrivate.devices[].label` (plan §5.2)
    /// so Profile can list "Neil's iPhone" rather than a bare token.
    /// `UIDevice.name` is the member's own device name; on iOS 16+ it is
    /// already a generic model name unless the app has the entitlement, which
    /// this one deliberately does not.
    private static func deviceLabel() -> String {
        UIDevice.current.name
    }
}

// MARK: - FCM token refresh

extension PushManager: MessagingDelegate {
    nonisolated func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let fcmToken else { return }
        Task { @MainActor in
            // Only re-register a *changed* token, and only when push is
            // already on for this device — a refresh must never quietly
            // enable notifications the member turned off.
            guard state == .enabled || storedToken != nil else { return }
            guard fcmToken != storedToken else { return }
            try? await register(token: fcmToken)
        }
    }
}

// MARK: - Presentation and taps

extension PushManager: UNUserNotificationCenterDelegate {
    /// Show the banner even while the app is in the foreground — the web
    /// client shows an in-app toast in the same situation.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let userInfo = response.notification.request.content.userInfo
        let data = userInfo.reduce(into: [String: Any]()) { result, pair in
            if let key = pair.key as? String { result[key] = pair.value }
        }
        let link = DeepLink.resolve(data)
        await MainActor.run { [weak self] in
            self?.onDeepLink?(link)
        }
    }
}

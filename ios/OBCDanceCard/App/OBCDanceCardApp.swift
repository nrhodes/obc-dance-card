//
//  OBCDanceCardApp.swift
//  Entry point. Configures Firebase before anything else touches it, owns the
//  long-lived stores, and swaps the root view on auth state.
//
//  The app delegate exists only for APNs: Firebase Messaging needs the raw
//  APNs token handed to it, and `UIApplicationDelegateAdaptor` is the only
//  way to get it in a SwiftUI lifecycle app.
//

import FirebaseCore
import FirebaseMessaging
import SwiftUI
import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        FirebaseService.configure()
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        // Never logged: an APNs token identifies a device (plan §3.7).
        Messaging.messaging().apnsToken = deviceToken
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Push simply stays off; nothing else in the app depends on it.
        print("apns_registration_failed \((error as NSError).code)")
    }
}

@main
struct OBCDanceCardApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    @StateObject private var auth = AuthModel()
    @StateObject private var router = Router()
    @StateObject private var push = PushManager()
    @StateObject private var appLock = AppLock()

    @StateObject private var programme = ProgrammeStore()
    @StateObject private var directory = MembersDirectoryStore()
    @StateObject private var invites = InvitesStore()
    @StateObject private var notifications = NotificationsStore()
    @StateObject private var teams = TeamsStore()
    @StateObject private var visitors = VisitorsStore()

    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(auth)
                .environmentObject(router)
                .environmentObject(push)
                .environmentObject(appLock)
                .environmentObject(programme)
                .environmentObject(directory)
                .environmentObject(invites)
                .environmentObject(notifications)
                .environmentObject(teams)
                .environmentObject(visitors)
                .task { start() }
                .onChange(of: auth.memberId) { _, memberId in
                    bindMemberScopedStores(to: memberId)
                }
                .onChange(of: scenePhase) { _, phase in
                    switch phase {
                    case .background, .inactive:
                        appLock.lockIfEnabled()
                    case .active:
                        if appLock.isLocked { Task { await appLock.unlock() } }
                    @unknown default:
                        break
                    }
                }
        }
    }

    private func start() {
        auth.onSignOut = { await push.unregisterOnSignOut() }
        auth.start()
        push.configure()
        push.onDeepLink = { link in router.open(link) }
        bindMemberScopedStores(to: auth.memberId)
    }

    /// Programme, members and teams are club-wide; invites, notifications and
    /// visitors are per-member and must be torn down and rebuilt when the
    /// signed-in member changes (including to nil on sign-out) so one
    /// member's data can never linger on a shared device.
    private func bindMemberScopedStores(to memberId: String?) {
        if memberId != nil {
            programme.start()
            directory.start()
            teams.start(selfId: memberId)
        } else {
            programme.stop()
            directory.stop()
            teams.stop()
        }
        invites.start(uid: memberId)
        notifications.start(uid: memberId)
        visitors.start(uid: memberId)
    }
}

/// Chooses between sign-in, the app, and the "your membership isn't active"
/// dead end, and puts the app lock over the top of all of it.
struct RootView: View {
    @EnvironmentObject private var auth: AuthModel
    @EnvironmentObject private var appLock: AppLock

    var body: some View {
        ZStack {
            switch auth.status {
            case .loading:
                ProgressView("Loading…")
                    .controlSize(.large)
            case .signedOut:
                SignInView()
            case .signedIn:
                MainTabView()
            case .notActive:
                NotActiveView()
            }

            if appLock.isLocked && auth.status == .signedIn {
                AppLockView(lock: appLock)
                    .transition(.opacity)
                    .zIndex(1)
            }
        }
        .animation(.default, value: auth.status)
    }
}

/// Shown when a member's account exists but has been deactivated. Mirrors the
/// web app's `NotActiveScreen`: no roster, no card, nothing but who to ask.
struct NotActiveView: View {
    @EnvironmentObject private var auth: AuthModel

    var body: some View {
        VStack(spacing: 20) {
            Text("Your membership isn't active")
                .font(.title2.weight(.semibold))
                .multilineTextAlignment(.center)
            Text("Please contact the club if you think this is a mistake.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button("Sign out") { Task { await auth.signOut() } }
                .buttonStyle(.bordered)
                .controlSize(.large)
        }
        .padding()
    }
}

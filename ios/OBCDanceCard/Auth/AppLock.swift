//
//  AppLock.swift
//  Optional Face ID / Touch ID app lock (plan §14.2, §8.2). Default **off**,
//  toggled in Profile.
//
//  This is a screen lock, not an auth mechanism: the Firebase session stays
//  live underneath, so unlocking is instant and a failed unlock never signs
//  anyone out or costs them their place. `LAPolicy.deviceOwnerAuthentication`
//  is used rather than `…WithBiometrics` so the device passcode is always
//  available as a fallback — a club member whose Face ID stops recognising
//  them (glasses, a plaster, a bad angle) must never be locked out of their
//  own card.
//
//  The preference lives in `UserDefaults`, not the Keychain: it is a display
//  choice, not a secret, and nothing about it is worth protecting.
//

import Foundation
import LocalAuthentication
import SwiftUI

@MainActor
final class AppLock: ObservableObject {
    private static let enabledKey = "obc.appLock.enabled"

    /// True when the member has turned the lock on in Profile.
    @Published var isEnabled: Bool {
        didSet {
            UserDefaults.standard.set(isEnabled, forKey: Self.enabledKey)
            // Turning it off must not leave a locked screen stranded.
            if !isEnabled { isLocked = false }
        }
    }

    /// True while the lock screen should cover the app.
    @Published private(set) var isLocked = false
    @Published private(set) var lastError: String?

    private var isAuthenticating = false

    init() {
        isEnabled = UserDefaults.standard.bool(forKey: Self.enabledKey)
    }

    /// Whether this device can do any kind of owner authentication at all.
    /// A device with no passcode set can't, and offering the toggle there
    /// would produce a switch that silently does nothing.
    var isAvailableOnDevice: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    /// Human name for whatever this device offers, for the Profile toggle.
    var biometryLabel: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
        switch context.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        default: return "your passcode"
        }
    }

    /// Called when the app leaves the foreground.
    func lockIfEnabled() {
        guard isEnabled else { return }
        isLocked = true
    }

    /// Called when the app returns to the foreground, and from the lock
    /// screen's "Unlock" button.
    func unlock() async {
        guard isLocked, !isAuthenticating else { return }
        isAuthenticating = true
        defer { isAuthenticating = false }

        let context = LAContext()
        context.localizedFallbackTitle = "Use passcode"
        do {
            let ok = try await context.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: "Unlock your dance card"
            )
            if ok {
                isLocked = false
                lastError = nil
            }
        } catch {
            // A cancel is not an error worth shouting about — the member can
            // tap Unlock again. Anything else gets a plain, generic line.
            let code = (error as NSError).code
            let cancelled = code == LAError.userCancel.rawValue
                || code == LAError.appCancel.rawValue
                || code == LAError.systemCancel.rawValue
            lastError = cancelled ? nil : "Couldn't unlock. Try again."
        }
    }
}

/// The cover shown while the app is locked. Deliberately shows nothing but
/// the app name — no card, no names, no notification previews.
struct AppLockView: View {
    @ObservedObject var lock: AppLock

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "lock.fill")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Text("Dance Card is locked")
                .font(.title2.weight(.semibold))
            if let error = lock.lastError {
                Text(error).foregroundStyle(.red)
            }
            Button {
                Task { await lock.unlock() }
            } label: {
                Text("Unlock with \(lock.biometryLabel)").frame(maxWidth: 320)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }
}

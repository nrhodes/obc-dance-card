//
//  ProfileView.swift
//  Profile — contact details, notification preferences, push, the optional
//  Face ID app lock, password, visitors, and sign out. The counterpart of
//  `web/src/screens/ProfileScreen.tsx` plus `PasswordSection`,
//  `NotificationPrefsForm` and `PushSettings`.
//
//  The member's email is shown but not editable: it is their login identity
//  and only an admin import can change it (plan §8.2). Phone is editable
//  because the booklet prints it and members correct their own.
//

import SwiftUI

struct ProfileView: View {
    @EnvironmentObject private var auth: AuthModel
    @EnvironmentObject private var appLock: AppLock
    @EnvironmentObject private var push: PushManager

    var body: some View {
        Group {
            if let member = auth.member, let memberPrivate = auth.memberPrivate {
                Form {
                    Section("You") {
                        LabeledContent("Name", value: member.fullName)
                        LabeledContent("Grade", value: member.grade.rawValue)
                        LabeledContent("Email", value: memberPrivate.emailLower)
                    }

                    ContactSection(initialPhone: member.phone)

                    Section("My visitors") {
                        NavigationLink(value: Route.visitors) {
                            Text("Manage my visitors")
                        }
                        Text("People who aren't members that you play with or sponsor.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }

                    CalendarFeedSection()

                    NotificationPrefsSection(initialPrefs: memberPrivate.notificationPrefs)

                    PushSection()

                    AppLockSection()

                    PasswordSection(hasPassword: memberPrivate.hasPassword, email: memberPrivate.emailLower)

                    Section {
                        NavigationLink("Getting started / Help", value: Route.help)
                        NavigationLink("Privacy", value: Route.privacy)
                    }

                    Section {
                        Button("Sign out", role: .destructive) {
                            Task { await auth.signOut() }
                        }
                    }
                }
            } else {
                ProgressView("Loading…")
            }
        }
        .navigationTitle("Profile")
    }
}

// MARK: - Contact

private struct ContactSection: View {
    let initialPhone: String

    @State private var phone: String
    @State private var saving = false
    @State private var saved = false
    @State private var errorMessage: String?

    init(initialPhone: String) {
        self.initialPhone = initialPhone
        _phone = State(initialValue: initialPhone)
    }

    var body: some View {
        Section("Contact") {
            if let errorMessage {
                Text(errorMessage).foregroundStyle(.red)
            }
            if saved {
                Text("Saved.").foregroundStyle(.green)
            }
            TextField("Phone", text: $phone)
                .textContentType(.telephoneNumber)
                .keyboardType(.phonePad)
                .onChange(of: phone) { _, _ in saved = false }
            Button(saving ? "Saving…" : "Save phone number") {
                Task { await save() }
            }
            .disabled(saving)
        }
    }

    private func save() async {
        saving = true
        saved = false
        errorMessage = nil
        do {
            try await Api.updateMyContact(phone: phone)
            saved = true
        } catch {
            errorMessage = ErrorMapper.genericMessage(error)
        }
        saving = false
    }
}

// MARK: - Notification preferences

private struct NotificationPrefsSection: View {
    @State private var prefs: NotificationPrefs
    @State private var saving = false
    @State private var saved = false
    @State private var errorMessage: String?

    init(initialPrefs: NotificationPrefs) {
        _prefs = State(initialValue: initialPrefs)
    }

    var body: some View {
        Section("Notifications") {
            if let errorMessage {
                Text(errorMessage).foregroundStyle(.red)
            }
            if saved {
                Text("Saved.").foregroundStyle(.green)
            }
            Toggle("Push notifications", isOn: binding(\.push))
            Text("Each phone also needs turning on under \"Notifications on this device\" below.")
                .font(.footnote).foregroundStyle(.secondary)
            Toggle("Email notifications", isOn: binding(\.email))
            Toggle("Session reminders", isOn: binding(\.reminders))
            if prefs.reminders {
                Picker("Remind me", selection: binding(\.reminderDaysBefore)) {
                    ForEach(0...7, id: \.self) { days in
                        Text(days == 0 ? "On the day" : "\(Fmt.pluralised(days, "day")) before").tag(days)
                    }
                }
            }
            Toggle("Tell me when someone is looking for a partner", isOn: binding(\.matchmakingAlerts))
            Picker("Email frequency", selection: binding(\.digest)) {
                Text("Send each one right away").tag(DigestMode.immediate)
                Text("Send one summary a day").tag(DigestMode.daily)
            }
            Button(saving ? "Saving…" : "Save preferences") {
                Task { await save() }
            }
            .disabled(saving)
        }
    }

    private func binding<Value>(_ keyPath: WritableKeyPath<NotificationPrefs, Value>) -> Binding<Value> {
        Binding(
            get: { prefs[keyPath: keyPath] },
            set: { prefs[keyPath: keyPath] = $0; saved = false }
        )
    }

    private func save() async {
        saving = true
        saved = false
        errorMessage = nil
        do {
            try await Api.updateMyPrefs(prefs)
            saved = true
        } catch {
            errorMessage = ErrorMapper.genericMessage(error)
        }
        saving = false
    }
}

// MARK: - Push

/// Push is off until the member turns it on here — the app never prompts on
/// its own (see `PushManager`).
private struct PushSection: View {
    @EnvironmentObject private var push: PushManager
    @EnvironmentObject private var auth: AuthModel

    /// The member-wide preference (`notificationPrefs.push`) gates the
    /// per-device registration, as on the web.
    private var prefsAllowPush: Bool { auth.memberPrivate?.notificationPrefs.push ?? true }

    var body: some View {
        Section("Notifications on this device") {
            if push.state != .denied && !prefsAllowPush {
                Text("Push notifications are turned off in your preferences above. Turn \"Push notifications\" on there first.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            switch push.state {
            case .denied:
                Text("Notifications are turned off for this app.")
                Text("Turn them back on in Settings › Notifications › Dance Card.")
                    .font(.footnote).foregroundStyle(.secondary)
            case .enabled:
                Text("Notifications are on for this device.")
                Button(push.busy ? "Turning off…" : "Turn off on this device") {
                    Task { await push.disable() }
                }
                .disabled(push.busy)
            case .prompt:
                Text("Get a notification on this phone when a partner responds, cancels, or invites you.")
                    .font(.footnote).foregroundStyle(.secondary)
                Button(push.busy ? "Turning on…" : "Turn on notifications on this device") {
                    Task { await push.enable() }
                }
                .disabled(push.busy || !prefsAllowPush)
            case let .error(message):
                Text(message).foregroundStyle(.red)
                Button("Try again") { Task { await push.enable() } }
                    .disabled(push.busy)
            }
        }
    }
}

// MARK: - App lock

private struct AppLockSection: View {
    @EnvironmentObject private var appLock: AppLock

    var body: some View {
        Section("App lock") {
            if appLock.isAvailableOnDevice {
                Toggle("Require \(appLock.biometryLabel) to open", isOn: $appLock.isEnabled)
                Text("You stay signed in — this just covers the app when you put it down.")
                    .font(.footnote).foregroundStyle(.secondary)
            } else {
                Text("Set a device passcode to use an app lock.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - Password

/// Setting a password calls the server-side `setPassword` callable, which
/// requires the member to have signed in within the last 10 minutes (plan
/// §8.2 as amended 2026-09-05, audit M1). The member is NEVER navigated away
/// to satisfy that: when the server answers `failed-precondition` with
/// `details.reason == "recent-login-required"`, this section stays put,
/// keeps the password already typed, takes the emailed 6-digit code inline
/// (`EmailCodeSections`), signs in with the custom token — which refreshes
/// the session's `auth_time` — and retries automatically. Mirrors
/// `web/src/screens/PasswordSection.tsx`. Removing a password rotates it to
/// an unknowable value server-side without ending the session (risk-reducing,
/// so no freshness check).
private struct PasswordSection: View {
    let hasPassword: Bool
    let email: String

    @EnvironmentObject private var auth: AuthModel

    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var submitting = false
    @State private var errorMessage: String?
    @State private var successMessage: String?
    @State private var confirmingRemoval = false
    /// Inline re-auth step (audit M1): shown instead of the form, never a
    /// navigation. `password`/`confirmPassword` are untouched while it's up.
    @State private var needsReauth = false

    var body: some View {
        if hasPassword {
            Section("Password") {
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
                if let successMessage { Text(successMessage).foregroundStyle(.green) }
                Button("Remove password", role: .destructive) { confirmingRemoval = true }
                    .disabled(submitting)
                Text("You'll sign in with an emailed code instead.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .alert("Remove your password?", isPresented: $confirmingRemoval) {
                Button("Remove password", role: .destructive) { Task { await remove() } }
                Button("Keep it", role: .cancel) {}
            } message: {
                Text("You will need to sign in with an emailed code next time instead of a password.")
            }
        } else if needsReauth {
            Section("Set a password (optional)") {
                Text("To keep your account safe, we've emailed you a 6-digit code. Enter it here to finish setting your password.")
                    .accessibilityAddTraits(.updatesFrequently)
            }
            EmailCodeSections(
                email: email,
                onVerified: { token in await reauthVerified(token: token) },
                onUseDifferentEmail: { needsReauth = false },
                useDifferentEmailLabel: "Cancel",
                verifyLabel: "Confirm",
                verifyingLabel: "Confirming…"
            )
        } else {
            Section("Set a password (optional)") {
                Text("You can always sign in with an emailed code. A password is optional and just saves you a step.")
                    .font(.footnote).foregroundStyle(.secondary)
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
                if let successMessage { Text(successMessage).foregroundStyle(.green) }
                SecureField("New password", text: $password)
                    .textContentType(.newPassword)
                SecureField("Confirm password", text: $confirmPassword)
                    .textContentType(.newPassword)
                Button(submitting ? "Saving…" : "Set password") { Task { await set() } }
                    .disabled(submitting)
            }
        }
    }

    private func set() async {
        errorMessage = nil
        successMessage = nil
        if let strengthError = passwordStrengthError(password) {
            errorMessage = strengthError
            return
        }
        guard password == confirmPassword else {
            errorMessage = "Those passwords do not match."
            return
        }
        submitting = true
        do {
            try await Api.setPassword(password)
            successMessage = "Password set."
            password = ""
            confirmPassword = ""
        } catch {
            if ErrorMapper.toAppError(error).isRecentLoginRequired {
                needsReauth = true
            } else {
                errorMessage = ErrorMapper.genericMessage(error)
            }
        }
        submitting = false
    }

    /// Runs once the inline code step verifies. Signing in with the fresh
    /// custom token gives the session a fresh `auth_time`, so the retry
    /// clears the server's recent-login check. Whatever fails here is not
    /// the "please re-auth" case again (we just did that), so it's shown as a
    /// normal error back on the form rather than looping on the code step.
    private func reauthVerified(token: String) async {
        submitting = true
        errorMessage = nil
        do {
            try await auth.signIn(withCustomToken: token)
            try await Api.setPassword(password)
            successMessage = "Password set."
            password = ""
            confirmPassword = ""
        } catch {
            errorMessage = ErrorMapper.genericMessage(error)
        }
        needsReauth = false
        submitting = false
    }

    private func remove() async {
        submitting = true
        errorMessage = nil
        do {
            try await Api.removePassword()
            successMessage = "Password removed. You'll sign in with an emailed code next time."
        } catch {
            errorMessage = ErrorMapper.genericMessage(error)
        }
        submitting = false
    }
}

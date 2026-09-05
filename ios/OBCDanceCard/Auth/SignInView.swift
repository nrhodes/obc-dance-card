//
//  SignInView.swift
//  Sign in (plan §8.2, §14.2). Two paths from one email field:
//    * "Email me a code" (primary) → `EmailCodeView` → `signIn(withCustomToken:)`
//    * "I have a password" (secondary) reveals a password field →
//      `signIn(withEmail:password:)`
//
//  No magic links, ever (plan §2): the copy always says *type* the code,
//  never "click the link in the email". The club's members are exactly the
//  demographic phishing campaigns target, and this app must not train them to
//  click links in emails to log in.
//

import SwiftUI

struct SignInView: View {
    @EnvironmentObject private var auth: AuthModel

    @State private var step: Step = .chooser
    @State private var email = ""
    @State private var showPasswordField = false
    @State private var password = ""
    @State private var passwordError: String?
    @State private var passwordSubmitting = false

    private enum Step { case chooser, code }

    private var emailValid: Bool {
        let trimmed = email.trimmingCharacters(in: .whitespaces)
        // Same shape check the web sign-in screen uses — a real check is the
        // server's job; this only gates the button.
        return trimmed.contains("@") && trimmed.contains(".") && !trimmed.contains(" ")
    }

    private var normalisedEmail: String {
        email.trimmingCharacters(in: .whitespaces).lowercased()
    }

    var body: some View {
        NavigationStack {
            Group {
                switch step {
                case .chooser: chooser
                case .code:
                    EmailCodeView(
                        email: normalisedEmail,
                        onVerified: { token in try await auth.signIn(withCustomToken: token) },
                        onUseDifferentEmail: { step = .chooser }
                    )
                }
            }
            .navigationTitle(step == .chooser ? "Sign in" : "Enter your code")
            .navigationBarTitleDisplayMode(.large)
        }
    }

    private var chooser: some View {
        Form {
            Section {
                TextField("Email address", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityLabel("Email address")
            } footer: {
                // No section header: it would just repeat the field's own
                // placeholder and label, which VoiceOver would then read
                // twice.
                Text("Use the email address the club has for you.")
            }

            Section {
                Button {
                    step = .code
                } label: {
                    Text("Email me a code").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(!emailValid)

                Button("I have a password") {
                    withAnimation { showPasswordField.toggle() }
                }
                .controlSize(.large)
            }

            if showPasswordField {
                Section("Password") {
                    if let passwordError {
                        Text(passwordError)
                            .foregroundStyle(.red)
                            .accessibilityAddTraits(.isStaticText)
                    }
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .onSubmit { Task { await signInWithPassword() } }
                    Button {
                        Task { await signInWithPassword() }
                    } label: {
                        Text(passwordSubmitting ? "Signing in…" : "Sign in").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(!emailValid || password.isEmpty || passwordSubmitting)
                }
            }

            Section {
                NavigationLink("Privacy") { PrivacyView() }
            }
        }
    }

    private func signInWithPassword() async {
        guard emailValid, !password.isEmpty else { return }
        passwordSubmitting = true
        passwordError = nil
        do {
            try await auth.signIn(email: normalisedEmail, password: password)
            // AuthModel picks up the new user and swaps the root view.
        } catch {
            passwordError = ErrorMapper.passwordSignIn(error)
        }
        passwordSubmitting = false
    }
}

/// The "enter the 6-digit code" step as its own screen (sign-in).
struct EmailCodeView: View {
    let email: String
    let onVerified: (String) async throws -> Void
    let onUseDifferentEmail: () -> Void

    var body: some View {
        Form {
            EmailCodeSections(email: email, onVerified: onVerified, onUseDifferentEmail: onUseDifferentEmail)
        }
    }
}

/// The "enter the 6-digit code" step as `Section`s, so it can also sit inline
/// in another `List`/`Form` — the Profile's set-password re-auth (plan §8.2,
/// audit M1) embeds it rather than navigating the member anywhere. Sends the
/// first code on appear. Counterpart of `web/src/auth/EmailCodeStep.tsx`.
struct EmailCodeSections: View {
    let email: String
    let onVerified: (String) async throws -> Void
    let onUseDifferentEmail: () -> Void
    var useDifferentEmailLabel = "Use a different email"
    /// "Sign in" for the sign-in flow; "Confirm" when re-authenticating inline.
    var verifyLabel = "Sign in"
    var verifyingLabel = "Signing in…"

    @StateObject private var flow = EmailCodeFlow()
    @State private var code = ""
    @State private var now = Date()
    @State private var sentOnce = false
    @State private var signInError: String?

    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var canSubmit: Bool {
        code.count == 6 && flow.phase != .verifying && flow.phase != .sending
    }

    var body: some View {
        // Modifiers go on rows, not on the `Section`: a List applies a
        // Section's modifiers to every row, so `.task` would fire per row.
        Section {
            Text("We've emailed a 6-digit code to \(email). It's valid for 10 minutes.")
                .font(.body)
                .task {
                    guard !sentOnce else { return }
                    sentOnce = true
                    await flow.sendCode(email: email)
                }
        }

        if let message = flow.errorMessage ?? signInError {
            Section {
                Text(message).foregroundStyle(.red)
            }
        }

        Section("6-digit code") {
            TextField("000000", text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .font(.system(.title, design: .monospaced))
                .multilineTextAlignment(.center)
                .accessibilityLabel("Six digit code")
                .onChange(of: code) { _, newValue in
                    // Accept a pasted code that carries spaces or dashes.
                    code = String(newValue.filter(\.isNumber).prefix(6))
                }
        }

        Section {
            Button {
                Task { await verify() }
            } label: {
                Text(flow.phase == .verifying ? verifyingLabel : verifyLabel).frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!canSubmit)

            Button(resendLabel) {
                Task { await flow.sendCode(email: email) }
            }
            .disabled(flow.secondsUntilResend(now: now) > 0 || flow.phase == .sending)
            .onReceive(ticker) { now = $0 }

            Button(useDifferentEmailLabel, action: onUseDifferentEmail)
        }
    }

    private var resendLabel: String {
        let seconds = flow.secondsUntilResend(now: now)
        return seconds > 0 ? "Send a new code (\(seconds)s)" : "Send a new code"
    }

    private func verify() async {
        signInError = nil
        guard let token = await flow.verify(email: email, code: code) else { return }
        do {
            try await onVerified(token)
        } catch {
            signInError = ErrorMapper.genericMessage(error)
        }
    }
}

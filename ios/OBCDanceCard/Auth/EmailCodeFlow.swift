//
//  EmailCodeFlow.swift
//  The "request a code, then verify it" state machine — a port of
//  `web/src/auth/useEmailCodeFlow.ts`. Deliberately has no opinion about what
//  happens after a successful verify: the caller gets the custom token back.
//
//  Nothing here is ever logged. A login code and an email address are both on
//  plan §3.7's never-log list.
//

import Foundation

@MainActor
final class EmailCodeFlow: ObservableObject {
    enum Phase: Equatable { case idle, sending, sent, verifying }

    static let resendCooldown: TimeInterval = 60

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var errorMessage: String?
    /// Resend is disabled until this instant. nil = never sent.
    @Published private(set) var resendAvailableAt: Date?

    func secondsUntilResend(now: Date = Date()) -> Int {
        guard let resendAvailableAt, resendAvailableAt > now else { return 0 }
        return Int(resendAvailableAt.timeIntervalSince(now).rounded(.up))
    }

    /// Always "succeeds" from the member's point of view whether or not the
    /// email is known (plan §8.2) — a false return means the *request* failed
    /// (rate limit, network), never "no such member".
    @discardableResult
    func sendCode(email: String) async -> Bool {
        phase = .sending
        errorMessage = nil
        do {
            try await Api.requestLoginCode(email: email)
            resendAvailableAt = Date().addingTimeInterval(Self.resendCooldown)
            phase = .sent
            return true
        } catch {
            errorMessage = ErrorMapper.codeFlow(error)
            if phase == .sending { phase = .idle }
            return false
        }
    }

    /// Returns the Firebase custom token on success, nil on failure (with
    /// `errorMessage` set to display-safe copy).
    func verify(email: String, code: String) async -> String? {
        phase = .verifying
        errorMessage = nil
        do {
            let result = try await Api.verifyLoginCode(email: email, code: code)
            return result.token
        } catch {
            errorMessage = ErrorMapper.codeFlow(error)
            phase = .sent
            return nil
        }
    }

    func reset() {
        phase = .idle
        errorMessage = nil
        resendAvailableAt = nil
    }
}

//
//  AppError.swift
//  Small, display-safe error shape plus the callable/auth error → copy
//  mappings. Mirrors `web/src/firebase.ts#toAppError`,
//  `web/src/lib/actionErrors.ts` and `web/src/auth/errors.ts` so both clients
//  say the same thing in the same situation.
//
//  Two rules from the plan drive everything here:
//   * §8.1 — sign-in copy must never let someone enumerate members: "unknown
//     email" and "wrong password" produce byte-identical text.
//   * §8.3 — `failed-precondition` messages are written server-side to be
//     display-safe (they name conflicting dates etc.) and are shown verbatim;
//     every other code gets a fixed, generic mapping. A raw Firebase error
//     string is never surfaced.
//

import Foundation
import FirebaseFunctions

/// Display-safe error. `code` is the bare `HttpsError` code from plan §8.3
/// (`unauthenticated`, `permission-denied`, `invalid-argument`,
/// `failed-precondition`, `not-found`, `resource-exhausted`, …), never a
/// Firebase-prefixed one.
struct AppError: Error {
    var code: String
    var message: String
    /// The `details` payload from a callable's `HttpsError` third argument,
    /// when present (e.g. `{ reason: "recent-login-required" }` from
    /// `setPassword` — audit M1). Server-controlled and structured, unlike
    /// `message`, which is plan §8.3 display-safe copy — details are for
    /// dispatching client behaviour, never for showing to the member.
    var details: [String: Any]?

    static let generic = AppError(code: "unknown", message: "Something went wrong.")

    /// `shared/src/schemas.ts#RECENT_LOGIN_REQUIRED_REASON`.
    static let recentLoginRequiredReason = "recent-login-required"

    /// True when this is `setPassword` saying the session is too old (plan
    /// §8.2 amended 2026-09-05): the fix is an inline re-auth, not an error.
    var isRecentLoginRequired: Bool {
        code == "failed-precondition"
            && details?["reason"] as? String == Self.recentLoginRequiredReason
    }
}

/// `details` is deliberately outside equality: it is untyped, and every test
/// and call site compares on the code/message pair.
extension AppError: Equatable {
    static func == (lhs: AppError, rhs: AppError) -> Bool {
        lhs.code == rhs.code && lhs.message == rhs.message
    }
}

enum ErrorMapper {
    /// Normalises anything thrown by a callable or by Firebase Auth into an
    /// `AppError`. Callable errors arrive as `NSError`s in
    /// `FunctionsErrorDomain` whose code is a `FunctionsErrorCode`; Auth
    /// errors arrive with a string code in `AuthErrorDomain`.
    static func toAppError(_ error: Error) -> AppError {
        if let appError = error as? AppError { return appError }

        let nsError = error as NSError
        if nsError.domain == FunctionsErrorDomain,
           let code = FunctionsErrorCode(rawValue: nsError.code) {
            let message = nsError.localizedDescription
            // The HttpsError third argument rides along in userInfo.
            let details = nsError.userInfo[FunctionsErrorDetailsKey] as? [String: Any]
            return AppError(code: httpsCode(for: code), message: message, details: details)
        }
        return AppError(code: nsError.domain.isEmpty ? "unknown" : "unknown",
                        message: nsError.localizedDescription)
    }

    /// `FunctionsErrorCode` → the plain HttpsError code strings the plan uses.
    private static func httpsCode(for code: FunctionsErrorCode) -> String {
        switch code {
        case .OK: return "ok"
        case .cancelled: return "cancelled"
        case .invalidArgument: return "invalid-argument"
        case .deadlineExceeded: return "deadline-exceeded"
        case .notFound: return "not-found"
        case .alreadyExists: return "already-exists"
        case .permissionDenied: return "permission-denied"
        case .resourceExhausted: return "resource-exhausted"
        case .failedPrecondition: return "failed-precondition"
        case .aborted: return "aborted"
        case .outOfRange: return "out-of-range"
        case .unimplemented: return "unimplemented"
        case .unavailable: return "unavailable"
        case .dataLoss: return "data-loss"
        case .unauthenticated: return "unauthenticated"
        case .unknown, .internal: return "internal"
        @unknown default: return "unknown"
        }
    }

    // MARK: - Display copy

    private static let tooManyInvites = "Too many invites today"
    private static let notAllowed = "You can't do that."
    private static let generic = "Something went wrong. Please try again."
    private static let tooManyAttempts = "Too many attempts. Please wait a few minutes and try again."
    private static let serviceBusy = "The service is busy right now. Please wait a moment and try again."
    private static let invalidCode = "That code is not valid. Request a new one."

    /// Deliberately identical for "unknown email" and "wrong password"
    /// (plan §8.1 enumeration protection).
    static let passwordMismatch =
        "That email and password don't match. You can sign in with an emailed code instead."

    /// For every card-core action (session actions, invites, teams, visitors).
    /// Mirrors `mapActionError`.
    static func action(_ error: Error) -> String {
        let appError = toAppError(error)
        switch appError.code {
        case "failed-precondition": return appError.message
        case "resource-exhausted": return tooManyInvites
        case "permission-denied": return notAllowed
        default: return generic
        }
    }

    /// For `requestLoginCode` / `verifyLoginCode`. Mirrors `mapCodeFlowError`.
    static func codeFlow(_ error: Error) -> String {
        switch toAppError(error).code {
        case "resource-exhausted": return tooManyAttempts
        case "invalid-argument": return invalidCode
        // A Cloud Run 429 (no free instance) surfaces as `unavailable` and a
        // timeout as `deadline-exceeded` — both are "try again shortly".
        case "unavailable", "deadline-exceeded": return serviceBusy
        default: return generic
        }
    }

    /// For `signIn(withEmail:password:)`. Deliberately ignores the specific
    /// Firebase Auth code. Mirrors `mapPasswordSignInError`.
    static func passwordSignIn(_ error: Error) -> String {
        _ = error
        return passwordMismatch
    }

    /// For any other, non-auth-flow-specific callable failure.
    /// Mirrors `mapGenericError`.
    static func genericMessage(_ error: Error) -> String {
        _ = error
        return generic
    }
}

/// The account password policy from `shared/src/validate.ts`
/// (`passwordStrengthError`): min 8 chars, at least one letter and one
/// number. Checked here for immediate feedback; the `setPassword` callable
/// enforces the identical rule server-side regardless.
func passwordStrengthError(_ password: String) -> String? {
    if password.count < 8 { return "Password must be at least 8 characters." }
    if password.rangeOfCharacter(from: .letters) == nil {
        return "Password must include at least one letter."
    }
    if password.rangeOfCharacter(from: .decimalDigits) == nil {
        return "Password must include at least one number."
    }
    return nil
}

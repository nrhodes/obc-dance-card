//
//  FirebaseService.swift
//  Single Firebase initialisation point — the mirror of `web/src/firebase.ts`.
//  Every other file uses `FirebaseService.auth` / `.db` / `.functions`; nothing
//  else calls `FirebaseApp.configure()` or `Firestore.firestore()` itself.
//
//  Notes that matter:
//   * Auth persistence is the SDK default (Keychain) — plan §2 "Sessions:
//     persistent". No manual token storage, ever.
//   * Firestore local persistence is switched **off**: club devices get
//     shared and lent out, and a cached roster surviving a sign-out is
//     exactly the leak plan §8.1 is about.
//   * App Check uses App Attest with a DeviceCheck fallback; the debug
//     provider is compiled in only for DEBUG builds pointed at the emulator.
//

import Foundation
import FirebaseAppCheck
import FirebaseAuth
import FirebaseCore
import FirebaseFirestore
import FirebaseFunctions

/// Chooses App Attest where the device supports it (iOS 14+ hardware) and
/// falls back to DeviceCheck otherwise. Registered *before* `configure()`,
/// which is when Firebase asks for a provider.
private final class OBCAppCheckProviderFactory: NSObject, AppCheckProviderFactory {
    func createProvider(with app: FirebaseApp) -> AppCheckProvider? {
        if #available(iOS 14.0, *) {
            if let provider = AppAttestProvider(app: app) { return provider }
        }
        return DeviceCheckProvider(app: app)
    }
}

enum FirebaseService {
    private(set) static var isConfigured = false

    static func configure() {
        guard !isConfigured else { return }

        // App Attest with a DeviceCheck fallback; the debug provider only in a
        // DEBUG build against the emulator (plan §14.2).
        //
        // Expect "AppCheck failed … placeholder token" in the console when
        // running against the emulator. A `demo-` project has no App Check
        // backend to exchange a token with, so no provider can succeed there
        // — the SDK falls back to a placeholder token and the emulator, which
        // runs with `ENFORCE_APP_CHECK=false`, accepts the request anyway.
        // It is noise, not a failure.
        #if DEBUG
        if AppEnvironment.useEmulators {
            AppCheck.setAppCheckProviderFactory(AppCheckDebugProviderFactory())
        } else {
            AppCheck.setAppCheckProviderFactory(OBCAppCheckProviderFactory())
        }
        #else
        AppCheck.setAppCheckProviderFactory(OBCAppCheckProviderFactory())
        #endif

        if let options = AppEnvironment.firebaseOptions() {
            FirebaseApp.configure(options: options)
        } else {
            // No GoogleService-Info.plist and not in emulator mode. Rather
            // than crash inside the SDK later, fail here with a message that
            // says what to do (the plist is gitignored — see
            // ios/GoogleService-Info.plist.example).
            fatalError(
                "Firebase is not configured: add ios/OBCDanceCard/GoogleService-Info.plist "
                + "(see GoogleService-Info.plist.example), or run the OBCDanceCard scheme "
                + "with OBC_USE_EMULATORS=1 to use the local emulator."
            )
        }

        // One settings object, assigned once. Firestore's `useEmulator` and a
        // `settings` assignment both write the same underlying host/SSL
        // fields, so doing both leaves the result dependent on which ran
        // last — and getting it wrong means the client speaks TLS to a plain
        // HTTP emulator and every listener fails a handshake. Setting the
        // emulator host and `isSSLEnabled` here, in the same object as the
        // cache policy, removes the ordering question entirely.
        let settings = FirestoreSettings()
        // Shared devices: never leave a roster cached on disk (plan §8.1).
        settings.cacheSettings = MemoryCacheSettings()

        if AppEnvironment.useEmulators {
            let host = AppEnvironment.emulatorHost
            settings.host = "\(host):\(AppEnvironment.firestoreEmulatorPort)"
            settings.isSSLEnabled = false
            Auth.auth().useEmulator(withHost: host, port: AppEnvironment.authEmulatorPort)
            functions.useEmulator(withHost: host, port: AppEnvironment.functionsEmulatorPort)
        }

        Firestore.firestore().settings = settings

        isConfigured = true
    }

    static var auth: Auth { Auth.auth() }
    static var db: Firestore { Firestore.firestore() }
    static let functions = Functions.functions(region: AppEnvironment.functionsRegion)

    /// The signed-in Firebase uid, or nil.
    static var uid: String? { auth.currentUser?.uid }
}

// MARK: - Callable plumbing

/// Typed wrapper around `httpsCallable`, mirroring `web/src/firebase.ts#callable`.
///
/// Never logs the input or the output: a callable payload can carry a login
/// code, an email address or a phone number, and plan §3.7 forbids logging
/// any of them. Failures are normalised to `AppError` so callers map them to
/// display-safe copy rather than surfacing a raw Firebase string.
enum Callable {
    static func call(_ name: String, _ payload: [String: Any] = [:]) async throws {
        _ = try await rawCall(name, payload)
    }

    static func call<Result: Decodable>(
        _ name: String,
        _ payload: [String: Any] = [:],
        as _: Result.Type
    ) async throws -> Result {
        let data = try await rawCall(name, payload)
        do {
            let json = try JSONSerialization.data(withJSONObject: data)
            return try JSONDecoder().decode(Result.self, from: json)
        } catch {
            throw AppError(code: "internal", message: "The server sent something unexpected.")
        }
    }

    private static func rawCall(_ name: String, _ payload: [String: Any]) async throws -> Any {
        do {
            let result = try await FirebaseService.functions.httpsCallable(name).call(payload)
            return result.data
        } catch {
            throw ErrorMapper.toAppError(error)
        }
    }
}

/// Builds a callable payload, **omitting** any key whose value is nil.
///
/// This is not a nicety: the server zod-parses `req.data` and an
/// `.optional()` field rejects an explicit `null` (see the same note in
/// `web/src/screens/SessionScreen.tsx`). Sending `note: nil` as `NSNull`
/// would fail validation where omitting it succeeds.
func payload(_ pairs: [String: Any?]) -> [String: Any] {
    pairs.reduce(into: [String: Any]()) { result, pair in
        if let value = pair.value { result[pair.key] = value }
    }
}

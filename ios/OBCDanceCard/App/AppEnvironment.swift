//
//  AppEnvironment.swift
//  Where the app points and how it attests, in one place.
//
//  Emulator mode (plan §14.2 / the iOS brief) is deliberately gated on
//  *both* a DEBUG build and an explicit environment variable set by the
//  scheme — a release build can never be pointed at a local emulator, and a
//  debug build run without the scheme still talks to the real project.
//
//  `GoogleService-Info.plist` is gitignored (plan §14.2); when it's absent
//  and we're in emulator mode, options are synthesised for the `demo-obc`
//  project so a fresh checkout can run against the emulator with no secrets
//  at all. When it's absent and we're *not* in emulator mode, that's a
//  misconfigured build and we say so loudly rather than half-starting.
//

import Foundation
import FirebaseCore

enum AppEnvironment {
    /// Cloud Functions region (plan §2). Must match the deployed callables.
    static let functionsRegion = "australia-southeast1"

    /// The emulator project id. The seed script refuses anything not
    /// starting with `demo-` (plan §3.10).
    static let emulatorProjectId = "demo-obc"

    static let firestoreEmulatorPort = 8080
    static let authEmulatorPort = 9099
    static let functionsEmulatorPort = 5001

    /// True only in a DEBUG build launched with `OBC_USE_EMULATORS=1`
    /// (set by the shared `OBCDanceCard` scheme).
    static var useEmulators: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.environment["OBC_USE_EMULATORS"] == "1"
        #else
        return false
        #endif
    }

    /// Host the emulator suite is listening on. `127.0.0.1` works for the
    /// simulator; a real device on the same network needs the Mac's LAN
    /// address, hence the override.
    static var emulatorHost: String {
        ProcessInfo.processInfo.environment["OBC_EMULATOR_HOST"] ?? "127.0.0.1"
    }

    /// Firebase options: the bundled plist when present, else synthesised
    /// emulator options. Returns nil when neither applies.
    static func firebaseOptions() -> FirebaseOptions? {
        if let path = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist"),
           let options = FirebaseOptions(contentsOfFile: path) {
            return options
        }
        guard useEmulators else { return nil }
        // Emulator-only stand-in. The emulator itself validates none of
        // these, but the Firebase SDK does before it ever sends a request:
        // `FirebaseInstallations` rejects an API key that isn't 39
        // characters starting with `A`, so this placeholder has to *look*
        // like a real key even though nothing will ever accept it. The
        // project id is the one that matters — it must be the `demo-` one
        // the emulator was started with.
        let options = FirebaseOptions(googleAppID: "1:000000000000:ios:0000000000000000",
                                      gcmSenderID: "000000000000")
        options.projectID = emulatorProjectId
        // Assembled rather than written as one literal so no string in this
        // repo matches a real Google API key's shape — the secret scanners
        // (gitleaks in CI, GitHub push protection) key off `AIza` followed by
        // 35 characters, and a placeholder that trips them costs more than it
        // saves.
        options.apiKey = "AIza" + String(repeating: "0", count: 35)
        options.bundleID = Bundle.main.bundleIdentifier ?? "nz.org.orewabridge.dancecard"
        return options
    }
}

//
//  EmulatorSignInTests.swift
//  End-to-end sign-in and read path against the **local emulator** — the
//  `ios/OBCDanceCardTests/ view-model tests against the emulator` from
//  `docs/ios-brief.md`.
//
//  These are the only tests here that touch the network, and they **skip**
//  (rather than fail) when the emulator isn't running, so a plain
//  `xcodebuild test` on a machine with no emulator still passes. Bring it up
//  first — see `ios/README.md`:
//
//      npm run build
//      firebase --config firebase/firebase.json --project demo-obc \
//        emulators:start --only auth,functions,firestore
//      FIRESTORE_EMULATOR_HOST=localhost:8080 \
//      FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 GCLOUD_PROJECT=demo-obc \
//        npm run seed -w @obc/functions
//
//  Recovering the login code: the console email provider writes each message
//  to `emulatorOutbox/{id}` when not deployed. Clients can't read that
//  collection (the rules' catch-all denies it), so — exactly as the web E2E
//  suite does in `web/e2e/support/emailOutbox.ts` — this reads it through the
//  Firestore emulator's documented `Authorization: Bearer owner` bypass,
//  which only works against an emulator.
//

import FirebaseAuth
import XCTest
@testable import OBCDanceCard

@MainActor
final class EmulatorSignInTests: XCTestCase {

    /// A seeded, non-admin member (`firebase/seed/seed.ts`).
    private let memberEmail = "john.smith@example.org"
    private let memberName = "John Smith"

    /// A *different* seeded member for the wrong-code test.
    /// `requestLoginCode` is rate-limited to 3 per email per 15 minutes
    /// (`auth/emailCode.ts`), so two tests sharing one address would exhaust
    /// the bucket and fail the second one for the wrong reason.
    private let otherMemberEmail = "mary.brown@example.org"

    private var host: String { AppEnvironment.emulatorHost }
    private var firestoreBase: String { "http://\(host):\(AppEnvironment.firestoreEmulatorPort)" }

    override func setUp() async throws {
        try await super.setUp()
        try XCTSkipUnless(AppEnvironment.useEmulators, "Not running against the emulator.")
        // Evaluated first: `XCTSkipUnless`'s condition is an autoclosure and
        // can't await.
        let reachable = await emulatorIsUp()
        try XCTSkipUnless(reachable, "Firestore emulator is not reachable at \(firestoreBase).")
        FirebaseService.configure()
        try? FirebaseService.auth.signOut()
        // Rate-limit buckets are persistent emulator state, so without this a
        // second run inside 15 minutes fails on `resource-exhausted` rather
        // than on anything real.
        try await clearRateLimits()
    }

    override func tearDown() async throws {
        try? FirebaseService.auth.signOut()
        try await super.tearDown()
    }

    // MARK: - The flow the brief calls "signs in against the emulator"

    func testEmailedCodeSignInThenReadsOwnMemberAndTheProgramme() async throws {
        let since = Date()

        // 1. Request a code. This resolves the same way whether or not the
        //    email is a known member (plan §8.2), so a success here proves
        //    only that the callable is reachable and accepted the input.
        try await Api.requestLoginCode(email: memberEmail)

        // 2. Recover it from the emulator-only outbox.
        let code = try await waitForLoginCode(to: memberEmail, since: since)
        XCTAssertEqual(code.count, 6)

        // 3. Exchange it for a custom token and sign in.
        let result = try await Api.verifyLoginCode(email: memberEmail, code: code)
        XCTAssertFalse(result.token.isEmpty)

        let auth = AuthModel()
        auth.start()
        try await auth.signIn(withCustomToken: result.token)

        // 4. The session resolves to an *active* member, read from the
        //    member's own `members/{uid}` doc through the rules.
        try await waitUntil("auth status is signedIn") { auth.status == .signedIn }
        XCTAssertEqual(auth.member?.fullName, memberName)
        XCTAssertEqual(auth.member?.role, .member)
        XCTAssertTrue(auth.member?.active == true)

        // `memberPrivate` is self-readable and carries the login identity.
        try await waitUntil("memberPrivate arrives") { auth.memberPrivate != nil }
        XCTAssertEqual(auth.memberPrivate?.emailLower, memberEmail)

        // 5. The published programme decodes into the store — this is the
        //    real check on the hand-written `Codable` mirrors, since it
        //    decodes documents the Cloud Functions actually wrote.
        let programme = ProgrammeStore()
        programme.start()
        try await waitUntil("programme loads") { !programme.loading && programme.year != nil }
        XCTAssertEqual(programme.programme?.status, .published)
        XCTAssertFalse(programme.weekdays.isEmpty, "seeded programme has weekdays")
        XCTAssertFalse(programme.series.isEmpty, "seeded programme has series")
        XCTAssertFalse(programme.sessions.isEmpty, "seeded programme has sessions")
        programme.stop()

        // 6. The members directory is readable by an active member (booklet
        //    parity, plan §2 "Visibility").
        let directory = MembersDirectoryStore()
        directory.start()
        try await waitUntil("directory loads") { !directory.loading && !directory.members.isEmpty }
        XCTAssertNotNil(directory.members.first { $0.fullName == memberName })
        directory.stop()

        await auth.signOut()
    }

    /// A wrong code must fail, and must fail with the code the UI maps to
    /// "That code is not valid" rather than something that leaks whether the
    /// email was known (plan §8.1/§8.2).
    func testAWrongCodeIsRejectedWithoutRevealingAnything() async throws {
        try await Api.requestLoginCode(email: otherMemberEmail)
        do {
            _ = try await Api.verifyLoginCode(email: otherMemberEmail, code: "000000")
            XCTFail("a wrong code should not produce a token")
        } catch {
            let mapped = ErrorMapper.codeFlow(error)
            XCTAssertTrue(
                mapped == "That code is not valid. Request a new one."
                    || mapped == "Too many attempts. Please wait a few minutes and try again.",
                "unexpected copy: \(mapped)"
            )
        }
    }

    /// An unknown email must look exactly like a known one from the client's
    /// side — no enumeration (plan §8.2 step 2).
    func testRequestLoginCodeSucceedsForAnUnknownEmailToo() async throws {
        try await Api.requestLoginCode(email: "definitely-not-a-member@example.org")
    }

    // MARK: - Helpers

    /// Deletes every `rateLimits/{bucket}` doc through the emulator's owner
    /// bypass, so the suite can be run repeatedly. Server-only collection —
    /// no client could do this against a real project, and nothing tries to.
    private func clearRateLimits() async throws {
        let base = "\(firestoreBase)/v1/projects/\(AppEnvironment.emulatorProjectId)"
            + "/databases/(default)/documents"
        var listRequest = URLRequest(url: URL(string: "\(base)/rateLimits?pageSize=300")!)
        listRequest.setValue("Bearer owner", forHTTPHeaderField: "Authorization")
        guard let (data, response) = try? await URLSession.shared.data(for: listRequest),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let documents = body["documents"] as? [[String: Any]]
        else { return }

        for document in documents {
            guard let name = document["name"] as? String,
                  let range = name.range(of: "/documents/")
            else { continue }
            let path = String(name[range.upperBound...])
            guard let url = URL(string: "\(base)/\(path)") else { continue }
            var deleteRequest = URLRequest(url: url)
            deleteRequest.httpMethod = "DELETE"
            deleteRequest.setValue("Bearer owner", forHTTPHeaderField: "Authorization")
            _ = try? await URLSession.shared.data(for: deleteRequest)
        }
    }

    private func emulatorIsUp() async -> Bool {
        var request = URLRequest(url: URL(string: firestoreBase)!)
        request.timeoutInterval = 2
        return (try? await URLSession.shared.data(for: request)) != nil
    }

    /// Polls until `condition` holds, or fails the test after `timeout`.
    /// Firestore listeners resolve asynchronously and there is no completion
    /// to await, so polling is the honest way to wait for one.
    private func waitUntil(
        _ what: String,
        timeout: TimeInterval = 15,
        _ condition: () -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTFail("Timed out waiting for: \(what)")
    }

    /// Reads the newest login-code email addressed to `to` from
    /// `emulatorOutbox` and pulls the 6 digits out of it. Polls, because the
    /// outbox write lands slightly after the callable returns.
    private func waitForLoginCode(to: String, since: Date, timeout: TimeInterval = 15) async throws -> String {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let code = try await latestCode(to: to, since: since) { return code }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        throw XCTSkip("No login-code email appeared in emulatorOutbox for \(to). Is the seed loaded?")
    }

    private func latestCode(to: String, since: Date) async throws -> String? {
        let url = URL(string:
            "\(firestoreBase)/v1/projects/\(AppEnvironment.emulatorProjectId)"
            + "/databases/(default)/documents:runQuery")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer owner", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "structuredQuery": [
                "from": [["collectionId": "emulatorOutbox"]],
                "where": [
                    "fieldFilter": [
                        "field": ["fieldPath": "to"],
                        "op": "EQUAL",
                        "value": ["stringValue": to],
                    ],
                ],
                "orderBy": [[
                    "field": ["fieldPath": "createdAt"],
                    "direction": "DESCENDING",
                ]],
                "limit": 20,
            ],
        ])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let rows = try JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return nil }

        for row in rows {
            guard let document = row["document"] as? [String: Any],
                  let fields = document["fields"] as? [String: Any],
                  let text = (fields["text"] as? [String: Any])?["stringValue"] as? String,
                  let createdAt = (fields["createdAt"] as? [String: Any])?["stringValue"] as? String,
                  let created = Fmt.parseInstant(createdAt),
                  created >= since.addingTimeInterval(-1)
            else { continue }
            if let code = firstSixDigitRun(in: text) { return code }
        }
        return nil
    }

    private func firstSixDigitRun(in text: String) -> String? {
        guard let range = text.range(of: #"\b\d{6}\b"#, options: .regularExpression) else { return nil }
        return String(text[range])
    }
}

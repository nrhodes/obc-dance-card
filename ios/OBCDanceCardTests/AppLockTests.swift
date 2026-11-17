//
//  AppLockTests.swift
//  Security review 2026-11-17, S1: the lock must be engaged from the moment
//  the app launches when the preference is on — not only after a trip to
//  the background.
//

import XCTest
@testable import OBCDanceCard

@MainActor
final class AppLockTests: XCTestCase {
    private let key = "obc.appLock.enabled"
    private var original: Any?

    override func setUp() {
        super.setUp()
        original = UserDefaults.standard.object(forKey: key)
    }

    override func tearDown() {
        if let original { UserDefaults.standard.set(original, forKey: key) }
        else { UserDefaults.standard.removeObject(forKey: key) }
        super.tearDown()
    }

    func testStartsLockedWhenTheLockIsEnabled() {
        UserDefaults.standard.set(true, forKey: key)
        let lock = AppLock()
        XCTAssertTrue(lock.isEnabled)
        XCTAssertTrue(lock.isLocked, "a cold launch with the lock on must present the cover, not the card")
    }

    func testStartsUnlockedWhenTheLockIsOff() {
        UserDefaults.standard.set(false, forKey: key)
        let lock = AppLock()
        XCTAssertFalse(lock.isEnabled)
        XCTAssertFalse(lock.isLocked)
    }

    func testTurningTheLockOffAlsoUnlocks() {
        UserDefaults.standard.set(true, forKey: key)
        let lock = AppLock()
        XCTAssertTrue(lock.isLocked)
        lock.isEnabled = false
        XCTAssertFalse(lock.isLocked)
    }
}

//
//  PushSoftAskTests.swift
//

import UserNotifications
import XCTest
@testable import OBCDanceCard

final class PushSoftAskTests: XCTestCase {

    func testOfferedOnlyWhileIosHasNotBeenAsked() {
        XCTAssertTrue(PushSoftAsk.shouldOffer(authorization: .notDetermined, prefsAllowPush: true, dismissed: false))
        for status in [UNAuthorizationStatus.authorized, .denied, .provisional, .ephemeral] {
            XCTAssertFalse(PushSoftAsk.shouldOffer(authorization: status, prefsAllowPush: true, dismissed: false),
                           "\(status.rawValue) already answers the question")
        }
    }

    func testNotOfferedWhenTheMemberWidePreferenceIsOff() {
        XCTAssertFalse(PushSoftAsk.shouldOffer(authorization: .notDetermined, prefsAllowPush: false, dismissed: false))
    }

    /// "Not now" is remembered per install, so the ask never nags.
    func testNotOfferedAgainAfterNotNow() {
        XCTAssertFalse(PushSoftAsk.shouldOffer(authorization: .notDetermined, prefsAllowPush: true, dismissed: true))
    }
}

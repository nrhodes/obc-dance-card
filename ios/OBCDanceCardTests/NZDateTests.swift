//
//  NZDateTests.swift
//  Ported from `shared/src/time.test.ts`. These are the cases that catch the
//  whole class of bug plan §6 exists to prevent: deriving an NZ calendar date
//  from a UTC instant, which is wrong for roughly half of every NZ day, and
//  in a way that flips direction across the DST boundary.
//

import XCTest
@testable import OBCDanceCard

final class NZDateTests: XCTestCase {

    // MARK: - today

    func testTodayRollsOverToTheNZCalendarDateNotTheUTCOne() {
        // 2027-01-11T11:30:00Z is 00:30 on 2027-01-12 in NZDT (UTC+13).
        XCTAssertEqual(NZDate.today(Fx.instant("2027-01-11T11:30:00Z")), "2027-01-12")
    }

    func testTodayIsStableAcrossTheAprilFallBack() {
        // NZ clocks go back at 2027-04-04 03:00 NZDT -> 02:00 NZST, i.e. at
        // 2027-04-03T14:00:00Z. The NZ calendar date is 2027-04-04 either side.
        XCTAssertEqual(NZDate.today(Fx.instant("2027-04-03T13:00:00Z")), "2027-04-04")
        XCTAssertEqual(NZDate.today(Fx.instant("2027-04-03T15:00:00Z")), "2027-04-04")
    }

    func testTodayIsStableAcrossTheSeptemberSpringForward() {
        // Clocks jump 2027-09-26 02:00 NZST -> 03:00 NZDT, i.e. 2027-09-25T14:00Z.
        XCTAssertEqual(NZDate.today(Fx.instant("2027-09-25T13:00:00Z")), "2027-09-26")
        XCTAssertEqual(NZDate.today(Fx.instant("2027-09-25T15:00:00Z")), "2027-09-26")
    }

    func testTodayDefaultsToNowAndHasTheIsoShape() {
        XCTAssertNotNil(NZDate.today().range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression))
    }

    // MARK: - isPast

    func testIsPastIsTrueStrictlyBeforeToday() {
        XCTAssertTrue(NZDate.isPast("2027-06-01", now: Fx.instant("2027-06-15T00:00:00Z")))
    }

    func testIsPastIsFalseForTodayAndFuture() {
        let now = Fx.instant("2027-01-11T11:30:00Z") // 2027-01-12 in NZ
        XCTAssertFalse(NZDate.isPast("2027-01-12", now: now))
        XCTAssertFalse(NZDate.isPast("2027-01-13", now: now))
    }

    // MARK: - weekday

    func testWeekdayOfKnownDates() {
        XCTAssertEqual(NZDate.weekday(of: "2027-01-11"), .monday)
        XCTAssertEqual(NZDate.weekday(of: "2027-01-12"), .tuesday)
        XCTAssertEqual(NZDate.weekday(of: "2027-01-13"), .wednesday)
        XCTAssertEqual(NZDate.weekday(of: "2027-01-14"), .thursday)
        XCTAssertEqual(NZDate.weekday(of: "2027-01-15"), .friday)
    }

    func testWeekdayRejectsTheWeekend() {
        // The club only runs Monday-Friday; a weekend date is a transcription
        // error, which the TS version throws on and this one reports as nil.
        XCTAssertNil(NZDate.weekday(of: "2027-01-16")) // Saturday
        XCTAssertNil(NZDate.weekday(of: "2027-01-17")) // Sunday
    }

    func testWeekdayIsUnaffectedByDSTAdjacentDates() {
        XCTAssertEqual(NZDate.weekday(of: "2027-04-05"), .monday)
        XCTAssertEqual(NZDate.weekday(of: "2027-09-27"), .monday)
    }

    func testWeekdayReturnsNilForAMalformedDate() {
        XCTAssertNil(NZDate.weekday(of: "not-a-date"))
    }

    // MARK: - addingDays

    func testAddingDaysCrossesMonthAndYearBoundaries() {
        XCTAssertEqual(NZDate.addingDays(1, to: "2027-01-31"), "2027-02-01")
        XCTAssertEqual(NZDate.addingDays(1, to: "2027-12-31"), "2028-01-01")
        XCTAssertEqual(NZDate.addingDays(-1, to: "2027-01-01"), "2026-12-31")
    }

    func testAddingDaysIsUnperturbedByADSTTransitionInTheSpan() {
        // 2027-04-04 and 2027-09-26 are the transition days; adding days
        // across them must still be plain calendar arithmetic.
        XCTAssertEqual(NZDate.addingDays(2, to: "2027-04-03"), "2027-04-05")
        XCTAssertEqual(NZDate.addingDays(2, to: "2027-09-25"), "2027-09-27")
    }

    func testAddingZeroDaysIsIdentity() {
        XCTAssertEqual(NZDate.addingDays(0, to: "2027-06-15"), "2027-06-15")
    }

    // MARK: - sessionCutoff

    func testSessionCutoffInNZSTWinter() {
        // 2027-07-12 13:00 NZST (UTC+12) => 2027-07-12T01:00:00Z
        XCTAssertEqual(
            NZDate.sessionCutoff(date: "2027-07-12", startTime: "13:00"),
            Fx.instant("2027-07-12T01:00:00Z")
        )
    }

    func testSessionCutoffInNZDTSummer() {
        // 2027-01-12 13:00 NZDT (UTC+13) => 2027-01-12T00:00:00Z
        XCTAssertEqual(
            NZDate.sessionCutoff(date: "2027-01-12", startTime: "13:00"),
            Fx.instant("2027-01-12T00:00:00Z")
        )
    }

    func testSessionCutoffForAnEveningSession() {
        // Thursday/Tuesday evenings start at 19:00. 2027-07-08 19:00 NZST
        // (UTC+12) => 2027-07-08T07:00:00Z.
        XCTAssertEqual(
            NZDate.sessionCutoff(date: "2027-07-08", startTime: "19:00"),
            Fx.instant("2027-07-08T07:00:00Z")
        )
    }

    func testSessionCutoffRoundTripsToTheSameNZCalendarDate() {
        let cutoff = NZDate.sessionCutoff(date: "2027-04-05", startTime: "13:00")
        XCTAssertEqual(NZDate.today(cutoff), "2027-04-05")
    }

    /// A malformed programme row must leave the session *open* rather than
    /// silently locking every member out of it.
    func testSessionCutoffFallsBackToDistantFutureForAMalformedDate() {
        XCTAssertEqual(NZDate.sessionCutoff(date: "", startTime: "13:00"), .distantFuture)
    }
}

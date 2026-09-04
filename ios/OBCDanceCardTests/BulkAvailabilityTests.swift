//
//  BulkAvailabilityTests.swift
//  Ported from `web/src/lib/bulkAvailability.test.ts` (plan §21 B2).
//

import XCTest
@testable import OBCDanceCard

final class BulkAvailabilityTests: XCTestCase {

    private let today = "2027-01-11" // Monday

    private func session(_ id: String, _ date: String, _ weekday: Weekday, kind: SessionKind = .series) -> Session {
        Session(id: id, date: date, weekday: weekday, seriesId: "series-\(weekday.rawValue)", kind: kind,
                title: "T", partnerRequired: true)
    }

    private func entry(_ sessionId: String, status: EntryStatus, teamId: String? = nil) -> Entry {
        Entry(id: "e-\(sessionId)", sessionId: sessionId, date: "2027-01-11", weekday: .monday,
              seriesId: "s", memberId: "member-a", status: status, teamId: teamId)
    }

    private var sessions: [Session] {
        [
            session("mon-1", "2027-01-11", .monday),
            session("tue-1", "2027-01-12", .tuesday),
            session("mon-2", "2027-01-18", .monday),
            session("mon-3", "2027-01-25", .monday),
            session("mon-past", "2027-01-04", .monday),
            session("mon-nobridge", "2027-02-01", .monday, kind: .noBridge),
        ]
    }

    func testMatchesTheChosenWeekdaysOnly() {
        let matched = BulkAvailability.matchingSessions(sessions, filter: .init(weekdays: [.monday]), today: today)
        XCTAssertEqual(matched.map(\.id), ["mon-1", "mon-2", "mon-3"])
    }

    func testExcludesPastSessionsAndNoBridge() {
        let matched = BulkAvailability.matchingSessions(sessions, filter: .init(weekdays: [.monday]), today: today)
        XCTAssertFalse(matched.contains { $0.id == "mon-past" })
        XCTAssertFalse(matched.contains { $0.id == "mon-nobridge" })
    }

    func testDateRangeIsClampedToToday() {
        let matched = BulkAvailability.matchingSessions(
            sessions, filter: .init(weekdays: [.monday], fromDate: "2026-12-01", toDate: "2027-01-18"), today: today
        )
        XCTAssertEqual(matched.map(\.id), ["mon-1", "mon-2"])
    }

    func testAFutureFromDateIsHonoured() {
        let matched = BulkAvailability.matchingSessions(
            sessions, filter: .init(weekdays: [.monday, .tuesday], fromDate: "2027-01-12"), today: today
        )
        XCTAssertEqual(matched.map(\.id), ["tue-1", "mon-2", "mon-3"])
    }

    func testEmptyWeekdaysMatchesNothing() {
        XCTAssertTrue(BulkAvailability.matchingSessions(sessions, filter: .init(weekdays: []), today: today).isEmpty)
    }

    func testPreviewCountsBookedSessionsAsSkipped() {
        let entries = [
            entry("mon-1", status: .confirmed),                 // booked: skipped
            entry("mon-2", status: .lookingForPartner),         // solo: will be overwritten
            entry("mon-3", status: .cancelled),                 // cancelled: as if absent
        ]
        let preview = BulkAvailability.preview(sessions: sessions, entries: entries,
                                               filter: .init(weekdays: [.monday]), today: today)
        XCTAssertEqual(preview, BulkAvailabilityPreview(matched: 3, bookedSkipped: 1, toUpdate: 2))
    }

    func testATeamEntryCountsAsBooked() {
        let preview = BulkAvailability.preview(
            sessions: sessions,
            entries: [entry("mon-1", status: .lookingForPartner, teamId: "t1")],
            filter: .init(weekdays: [.monday]), today: today
        )
        XCTAssertEqual(preview.bookedSkipped, 1)
    }

    func testAnAlreadyUnavailableEntryIsStillCountedAsToUpdate() {
        let preview = BulkAvailability.preview(
            sessions: sessions, entries: [entry("mon-1", status: .unavailable)],
            filter: .init(weekdays: [.monday]), today: today
        )
        XCTAssertEqual(preview, BulkAvailabilityPreview(matched: 3, bookedSkipped: 0, toUpdate: 3))
    }
}

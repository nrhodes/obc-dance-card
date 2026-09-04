//
//  OverviewTests.swift
//  Ported from `web/src/lib/overview.test.ts` (plan §21 B4). Same fixtures,
//  same dates (2027-01-11 is a Monday), same expectations.
//

import XCTest
@testable import OBCDanceCard

final class OverviewTests: XCTestCase {

    private let today = "2027-01-11" // Monday

    private func session(id: String = "s-2027-01-11", date: String = "2027-01-11",
                         weekday: Weekday = .monday, kind: SessionKind = .series) -> Session {
        Session(id: id, date: date, weekday: weekday, seriesId: "monday-pairs", kind: kind,
                title: "Monday Pairs", partnerRequired: true)
    }

    private func entry(id: String = "e1", sessionId: String = "s-2027-01-11", date: String = "2027-01-11",
                       status: EntryStatus = .confirmed, teamId: String? = nil) -> Entry {
        Entry(id: id, sessionId: sessionId, date: date, weekday: .monday, seriesId: "monday-pairs",
              memberId: "member-a", status: status, teamId: teamId)
    }

    // MARK: sessionMemberStatus

    func testOpenWhenNoEntry() {
        XCTAssertEqual(Overview.sessionMemberStatus(session(), entries: []), .open)
    }

    func testOpenWhenEntryCancelled() {
        XCTAssertEqual(Overview.sessionMemberStatus(session(), entries: [entry(status: .cancelled)]), .open)
    }

    func testBookedForConfirmedSubstitutedOrTeam() {
        XCTAssertEqual(Overview.sessionMemberStatus(session(), entries: [entry(status: .confirmed)]), .booked)
        XCTAssertEqual(Overview.sessionMemberStatus(session(), entries: [entry(status: .substituted)]), .booked)
        XCTAssertEqual(Overview.sessionMemberStatus(session(), entries: [entry(status: .lookingForPartner, teamId: "team-1")]), .booked)
    }

    func testSeekingForLookingOrAvailable() {
        XCTAssertEqual(Overview.sessionMemberStatus(session(), entries: [entry(status: .lookingForPartner)]), .seeking)
        XCTAssertEqual(Overview.sessionMemberStatus(session(), entries: [entry(status: .available)]), .seeking)
    }

    func testUnavailableForUnavailableEntry() {
        XCTAssertEqual(Overview.sessionMemberStatus(session(), entries: [entry(status: .unavailable)]), .unavailable)
    }

    // MARK: dayStatus

    func testNoneForAPastDayRegardless() {
        let s = session(id: "s-past", date: "2020-01-06")
        let e = entry(sessionId: "s-past", date: "2020-01-06", status: .confirmed)
        XCTAssertEqual(Overview.dayStatus("2020-01-06", sessions: [s], entries: [e], today: today), .none)
    }

    func testNoneWhenNoBookableSession() {
        XCTAssertEqual(Overview.dayStatus(today, sessions: [], entries: [], today: today), .none)
        XCTAssertEqual(Overview.dayStatus(today, sessions: [session(kind: .noBridge)], entries: [], today: today), .none)
    }

    func testSingleSessionDayStatuses() {
        XCTAssertEqual(Overview.dayStatus(today, sessions: [session()], entries: [entry(status: .confirmed)], today: today), .booked)
        XCTAssertEqual(Overview.dayStatus(today, sessions: [session()], entries: [], today: today), .open)
        XCTAssertEqual(Overview.dayStatus(today, sessions: [session()], entries: [entry(status: .lookingForPartner)], today: today), .seeking)
        XCTAssertEqual(Overview.dayStatus(today, sessions: [session()], entries: [entry(status: .unavailable)], today: today), .unavailable)
    }

    func testMultiSessionDay() {
        let sessions = [session(id: "s-a"), session(id: "s-b")]
        XCTAssertEqual(Overview.dayStatus(today, sessions: sessions, entries: [
            entry(sessionId: "s-a", status: .confirmed), entry(id: "e2", sessionId: "s-b", status: .confirmed),
        ], today: today), .booked)
        XCTAssertEqual(Overview.dayStatus(today, sessions: sessions, entries: [
            entry(sessionId: "s-a", status: .confirmed),
        ], today: today), .partly)
        // partly beats seeking
        XCTAssertEqual(Overview.dayStatus(today, sessions: sessions, entries: [
            entry(sessionId: "s-a", status: .confirmed), entry(id: "e2", sessionId: "s-b", status: .lookingForPartner),
        ], today: today), .partly)
        XCTAssertEqual(Overview.dayStatus(today, sessions: sessions, entries: [
            entry(sessionId: "s-a", status: .lookingForPartner),
        ], today: today), .seeking)
        XCTAssertEqual(Overview.dayStatus(today, sessions: sessions, entries: [
            entry(sessionId: "s-a", status: .unavailable), entry(id: "e2", sessionId: "s-b", status: .unavailable),
        ], today: today), .unavailable)
        // partial unavailable reads as open — there is still something to book
        XCTAssertEqual(Overview.dayStatus(today, sessions: sessions, entries: [
            entry(sessionId: "s-a", status: .unavailable),
        ], today: today), .open)
    }

    // MARK: buildAgenda

    func testAgendaOmitsDaysWithNothingIncludingWeekends() {
        let sessions = [session(id: "s-mon", date: "2027-01-11"), session(id: "s-fri", date: "2027-01-15", weekday: .friday)]
        let agenda = Overview.buildAgenda(from: "2027-01-11", days: 7, sessions: sessions, entries: [])
        XCTAssertEqual(agenda.map(\.date), ["2027-01-11", "2027-01-15"])
    }

    func testAgendaCarriesYearFromDateAndPerSessionStatus() {
        let sessions = [session()]
        let agenda = Overview.buildAgenda(from: "2027-01-11", days: 1, sessions: sessions, entries: [entry(status: .confirmed)])
        XCTAssertEqual(agenda.count, 1)
        XCTAssertEqual(agenda[0].sessions.map(\.year), [2027])
        XCTAssertEqual(agenda[0].sessions.map(\.status), [.booked])
    }

    func testAgendaExcludesNoBridge() {
        XCTAssertTrue(Overview.buildAgenda(from: "2027-01-11", days: 1, sessions: [session(kind: .noBridge)], entries: []).isEmpty)
    }

    // MARK: buildMonthGrid

    func testMonthGridIsFiveWideEveryWeek() {
        for week in Overview.buildMonthGrid(year: 2027, month: 1, sessions: [], entries: [], today: "2027-01-01") {
            XCTAssertEqual(week.count, 5)
        }
    }

    func testLeadingPaddingPutsDayOneInItsColumn() {
        // 2027-01-01 is a Friday -> column 4.
        let first = Overview.buildMonthGrid(year: 2027, month: 1, sessions: [], entries: [], today: "2027-01-01")[0]
        XCTAssertNil(first[0]); XCTAssertNil(first[1]); XCTAssertNil(first[2]); XCTAssertNil(first[3])
        XCTAssertEqual(first[4]?.dayOfMonth, 1)
    }

    func testWeekendsGetNoCellAtAll() {
        // Feb 2027 starts on a Monday: 20 weekday cells, 4 clean rows.
        let weeks = Overview.buildMonthGrid(year: 2027, month: 2, sessions: [], entries: [], today: "2027-02-01")
        XCTAssertEqual(weeks.flatMap { $0 }.compactMap { $0 }.count, 20)
        XCTAssertTrue(weeks.allSatisfy { $0.count == 5 })
    }

    func testCellCarriesStatusAndSessions() {
        let sessions = [session(date: "2027-01-11")]
        let weeks = Overview.buildMonthGrid(year: 2027, month: 1, sessions: sessions, entries: [entry(status: .confirmed)], today: "2027-01-01")
        let cell = weeks.flatMap { $0 }.compactMap { $0 }.first { $0.date == "2027-01-11" }
        XCTAssertEqual(cell?.status, .booked)
        XCTAssertEqual(cell?.sessions, sessions)
    }

    func testMonthBoundaryAprilToMay() {
        let april = Overview.buildMonthGrid(year: 2027, month: 4, sessions: [], entries: [], today: "2027-04-01")
        XCTAssertEqual(april.flatMap { $0 }.compactMap { $0 }.last?.date, "2027-04-30")
        let may = Overview.buildMonthGrid(year: 2027, month: 5, sessions: [], entries: [], today: "2027-05-01")
        XCTAssertEqual(may.flatMap { $0 }.compactMap { $0 }.first?.date, "2027-05-03")
    }

    // MARK: buildYearOverview

    func testYearOverviewHasTwelveMonthsPaddedToSixRows() {
        let overview = Overview.buildYearOverview(year: 2026, sessions: [], entries: [], today: "2026-01-01")
        XCTAssertEqual(overview.map(\.month), Array(1...12))
        XCTAssertTrue(overview.allSatisfy { $0.weeks.count == 6 })
        let feb = overview.first { $0.month == 2 }!
        XCTAssertEqual(feb.weeks.flatMap { $0 }.compactMap { $0 }.count, 20) // Feb 2026: 20 weekdays
    }

    func testYearOverviewReflectsABookedDay() {
        let s = session(id: "s-2027-03-08", date: "2027-03-08")
        let overview = Overview.buildYearOverview(year: 2027, sessions: [s], entries: [entry(sessionId: "s-2027-03-08", status: .confirmed)], today: "2027-01-01")
        let cell = overview.first { $0.month == 3 }!.weeks.flatMap { $0 }.compactMap { $0 }.first { $0.date == "2027-03-08" }
        XCTAssertEqual(cell?.status, .booked)
    }
}

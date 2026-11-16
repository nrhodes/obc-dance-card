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
        for week in Overview.buildMonthGrid(year: 2027, month: 1, sessions: [], entries: [], today: "2027-01-01").weeks {
            XCTAssertEqual(week.count, 5)
        }
    }

    func testLeadingPaddingPutsDayOneInItsColumn() {
        // 2027-01-01 is a Friday -> column 4.
        let first = Overview.buildMonthGrid(year: 2027, month: 1, sessions: [], entries: [], today: "2027-01-01").weeks[0]
        XCTAssertNil(first[0]); XCTAssertNil(first[1]); XCTAssertNil(first[2]); XCTAssertNil(first[3])
        XCTAssertEqual(first[4]?.dayOfMonth, 1)
    }

    func testWeekendsGetNoCellAtAll() {
        // Feb 2027 starts on a Monday: 20 weekday cells, 4 clean rows.
        let weeks = Overview.buildMonthGrid(year: 2027, month: 2, sessions: [], entries: [], today: "2027-02-01").weeks
        XCTAssertEqual(weeks.flatMap { $0 }.compactMap { $0 }.count, 20)
        XCTAssertTrue(weeks.allSatisfy { $0.count == 5 })
    }

    func testCellCarriesStatusAndSessions() {
        let sessions = [session(date: "2027-01-11")]
        let weeks = Overview.buildMonthGrid(year: 2027, month: 1, sessions: sessions, entries: [entry(status: .confirmed)], today: "2027-01-01").weeks
        let cell = weeks.flatMap { $0 }.compactMap { $0 }.first { $0.date == "2027-01-11" }
        XCTAssertEqual(cell?.status, .booked)
        XCTAssertEqual(cell?.sessions, sessions)
    }

    func testMonthBoundaryAprilToMay() {
        let april = Overview.buildMonthGrid(year: 2027, month: 4, sessions: [], entries: [], today: "2027-04-01").weeks
        XCTAssertEqual(april.flatMap { $0 }.compactMap { $0 }.last?.date, "2027-04-30")
        let may = Overview.buildMonthGrid(year: 2027, month: 5, sessions: [], entries: [], today: "2027-05-01").weeks
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

    // MARK: series fusion (ports of `web/src/lib/overview.test.ts`)

    private func seriesDoc(id: String = "monday-pairs", name: String = "Monday Pairs", year: Int = 0) -> Series {
        Series(id: id, weekday: .monday, name: name, format: .pairs, allowSubstitute: true, order: 0,
               sessionIds: [], teamMin: 4, teamMax: 6, year: year)
    }

    private func cellFor(_ weeks: [Overview.MonthWeek], _ date: String) -> Overview.MonthDayCell? {
        weeks.flatMap { $0 }.compactMap { $0 }.first { $0.date == date }
    }

    private func oneOff(_ date: String) -> Session {
        Session(id: "h-\(date)", date: date, weekday: .monday, seriesId: nil, kind: .holidayBridge, title: "Holiday Bridge")
    }

    private func campbell(id: String, date: String) -> Session {
        var s = session(id: id, date: date); s.seriesId = "campbell"; s.title = "Campbell Cave Pairs"; return s
    }

    func testRunPositionsAreEmptyWithoutSeriesSessions() {
        XCTAssertTrue(Overview.computeSeriesRunPositions([]).isEmpty)
        XCTAssertTrue(Overview.computeSeriesRunPositions([oneOff("2027-01-11")]).isEmpty)
    }

    func testASingleSessionSeriesIsSolo() {
        XCTAssertEqual(Overview.computeSeriesRunPositions([session(date: "2027-01-11")])["2027:monday-pairs:2027-01-11"], .solo)
    }

    func testRunPositionsFollowDateOrderRegardlessOfInputOrder() {
        let positions = Overview.computeSeriesRunPositions([
            session(id: "s3", date: "2027-01-25"), session(id: "s1", date: "2027-01-11"), session(id: "s2", date: "2027-01-18"),
        ])
        XCTAssertEqual(positions["2027:monday-pairs:2027-01-11"], .start)
        XCTAssertEqual(positions["2027:monday-pairs:2027-01-18"], .middle)
        XCTAssertEqual(positions["2027:monday-pairs:2027-01-25"], .end)
    }

    func testRunPositionsAreKeyedByYearSoSeriesIdsCanCollideAcrossYears() {
        let positions = Overview.computeSeriesRunPositions([
            session(id: "s1", date: "2027-01-11"), session(id: "s2", date: "2027-01-18"), session(id: "s3", date: "2028-01-10"),
        ])
        XCTAssertEqual(positions["2027:monday-pairs:2027-01-11"], .start)
        XCTAssertEqual(positions["2028:monday-pairs:2028-01-10"], .solo) // an independent run, not 2027's third session
    }

    func testAOneOffDayIsNotPartOfAnyRun() {
        let cell = cellFor(Overview.buildMonthGrid(year: 2027, month: 1, sessions: [oneOff("2027-01-11")], entries: [], today: "2027-01-01").weeks, "2027-01-11")
        XCTAssertNil(cell?.seriesRun)
        XCTAssertEqual(cell?.seriesNames, [])
    }

    func testALoneSessionIsSoloAndNamedFromTheSeriesDoc() {
        let grid = Overview.buildMonthGrid(year: 2027, month: 1, sessions: [session(date: "2027-01-11")], entries: [], series: [seriesDoc()], today: "2027-01-01")
        let cell = cellFor(grid.weeks, "2027-01-11")
        XCTAssertEqual(cell?.seriesRun, .solo)
        XCTAssertEqual(cell?.seriesNames, ["Monday Pairs"])
    }

    /// A run spanning a month boundary must not get a false cap at the edge.
    func testARunAcrossAMonthBoundaryIsUncappedOnBothSides() {
        let sessions = ["2027-01-11", "2027-01-18", "2027-01-25", "2027-02-01", "2027-02-08"].enumerated().map { i, d in session(id: "s\(i)", date: d) }
        let jan = Overview.buildMonthGrid(year: 2027, month: 1, sessions: sessions, entries: [], today: "2027-01-01").weeks
        let feb = Overview.buildMonthGrid(year: 2027, month: 2, sessions: sessions, entries: [], today: "2027-01-01").weeks
        XCTAssertEqual(cellFor(jan, "2027-01-11")?.seriesRun, .start)
        XCTAssertEqual(cellFor(jan, "2027-01-25")?.seriesRun, .middle) // run continues into February
        XCTAssertEqual(cellFor(feb, "2027-02-01")?.seriesRun, .middle) // continued from January
        XCTAssertEqual(cellFor(feb, "2027-02-08")?.seriesRun, .end)
    }

    func testAMultiSeriesDayFollowsItsFirstSession() {
        let grid = Overview.buildMonthGrid(year: 2027, month: 1,
                                           sessions: [session(id: "s1", date: "2027-01-11"), campbell(id: "s2", date: "2027-01-11"), campbell(id: "s3", date: "2027-01-18")],
                                           entries: [], today: "2027-01-01")
        let cell = cellFor(grid.weeks, "2027-01-11")
        XCTAssertEqual(cell?.seriesRun, .solo) // monday-pairs' lone session comes first
        XCTAssertEqual(cell?.seriesNames.sorted(), ["Campbell Cave Pairs", "Monday Pairs"])
    }

    func testSeriesNameFallsBackToTheSessionsOwnDenormalisedName() {
        var s = session(date: "2027-01-11"); s.seriesId = "unknown-series"; s.seriesName = "Denormalised Name"
        let cell = cellFor(Overview.buildMonthGrid(year: 2027, month: 1, sessions: [s], entries: [], today: "2027-01-01").weeks, "2027-01-11")
        XCTAssertEqual(cell?.seriesNames, ["Denormalised Name"])
    }

    func testSeriesNameOnlyMatchesADocFromTheSameYear() {
        let wrongYear = seriesDoc(name: "Wrong Year Series", year: 2099)
        let cell = cellFor(Overview.buildMonthGrid(year: 2027, month: 1, sessions: [session(date: "2027-01-11")], entries: [], series: [wrongYear], today: "2027-01-01").weeks, "2027-01-11")
        XCTAssertEqual(cell?.seriesNames, ["Monday Pairs"]) // the session's own title, not the 2099 doc
    }

    func testSeriesKeyIsEmptyWithoutSeriesSessions() {
        XCTAssertTrue(Overview.buildMonthGrid(year: 2027, month: 1, sessions: [oneOff("2027-01-11")], entries: [], today: "2027-01-01").seriesKey.isEmpty)
    }

    func testSeriesKeyListsEachSeriesOnceInFirstDateOrderWithAscendingDates() {
        let grid = Overview.buildMonthGrid(year: 2027, month: 1,
                                           sessions: [campbell(id: "s1", date: "2027-01-25"), session(id: "s2", date: "2027-01-11"), session(id: "s3", date: "2027-01-18")],
                                           entries: [], today: "2027-01-01")
        XCTAssertEqual(grid.seriesKey, [
            Overview.MonthSeriesKeyEntry(seriesId: "monday-pairs", name: "Monday Pairs", dates: ["2027-01-11", "2027-01-18"]),
            Overview.MonthSeriesKeyEntry(seriesId: "campbell", name: "Campbell Cave Pairs", dates: ["2027-01-25"]),
        ])
    }

    func testYearOverviewReflectsABookedDay() {
        let s = session(id: "s-2027-03-08", date: "2027-03-08")
        let overview = Overview.buildYearOverview(year: 2027, sessions: [s], entries: [entry(sessionId: "s-2027-03-08", status: .confirmed)], today: "2027-01-01")
        let cell = overview.first { $0.month == 3 }!.weeks.flatMap { $0 }.compactMap { $0 }.first { $0.date == "2027-03-08" }
        XCTAssertEqual(cell?.status, .booked)
    }
}

//
//  Overview.swift
//  Pure view-model for the Calendar screen — a 1:1 port of
//  `web/src/lib/overview.ts` (plan §21 B4 "Calendar overview", B2 bulk
//  availability preview). Everything is derived from the member's entries
//  plus the loaded programme's sessions; no Firestore, no SwiftUI.
//
//  Day-status taxonomy for a member + calendar date (see `dayStatus`):
//  - `none`         no bookable session that day, or the day is already past
//                   (a past day is always muted — the calendar looks forward).
//  - `booked`       a booked entry (confirmed/substituted, or any entry with a
//                   teamId) for *every* bookable session that day.
//  - `partly`       booked for some of that day's bookable sessions, not all.
//  - `seeking`      not booked anywhere that day, but a looking_for_partner /
//                   available entry on at least one of its sessions.
//  - `unavailable`  not booked/seeking, and an `unavailable` entry covers
//                   *every* bookable session that day — partial coverage
//                   reads as `open` (there is still something to book).
//  - `open`         a bookable session the member has no active relationship
//                   with — the state the month/year views exist to surface.
//
//  All date math goes through `NZDate`. `NZDate.weekday(of:)` returns nil for
//  Saturday/Sunday (the club only runs Monday–Friday); the grids skip those
//  days entirely, and the agenda only ever looks at dates sessions exist on.
//
//  `Session` already denormalises `title`/`format`, so nothing here needs a
//  series lookup — which would also risk the cross-year `seriesId` collision
//  plan §21 B3 calls out. A session's year comes from its own date.
//

import Foundation

enum DayStatus: String, CaseIterable, Hashable {
    case none, booked, partly, seeking, unavailable, open
}

/// Per-session member status — what `dayStatus` aggregates over a day.
enum SessionMemberStatus: String, Hashable {
    case booked, seeking, unavailable, open
}

enum Overview {

    /// A booked entry occupies the slot outright (mirrors the server's
    /// `entries/lib.ts#isBooked`).
    static func isBookedEntry(_ entry: Entry) -> Bool {
        entry.status == .confirmed || entry.status == .substituted || entry.teamId != nil
    }

    private static func isSeekingEntry(_ entry: Entry) -> Bool {
        entry.status == .lookingForPartner || entry.status == .available
    }

    /// The member's non-cancelled entry for `session`, if any.
    private static func entry(for session: Session, in entries: [Entry]) -> Entry? {
        entries.first { $0.sessionId == session.id && $0.status != .cancelled }
    }

    /// One bookable session's status for this member — `open` with no active entry.
    static func sessionMemberStatus(_ session: Session, entries: [Entry]) -> SessionMemberStatus {
        guard let e = entry(for: session, in: entries) else { return .open }
        if isBookedEntry(e) { return .booked }
        if isSeekingEntry(e) { return .seeking }
        if e.status == .unavailable { return .unavailable }
        return .open
    }

    /// Every bookable (`kind != noBridge`) session on `date`.
    static func bookableSessions(on date: String, in sessions: [Session]) -> [Session] {
        sessions.filter { $0.date == date && $0.kind != .noBridge }
    }

    /// The day-level status for one member + calendar date. See the taxonomy above.
    static func dayStatus(
        _ date: String,
        sessions: [Session],
        entries: [Entry],
        today: String = NZDate.today()
    ) -> DayStatus {
        if date < today { return .none }
        let daySessions = bookableSessions(on: date, in: sessions)
        if daySessions.isEmpty { return .none }

        let statuses = daySessions.map { sessionMemberStatus($0, entries: entries) }
        let bookedCount = statuses.filter { $0 == .booked }.count
        if bookedCount == daySessions.count { return .booked }
        if bookedCount > 0 { return .partly }
        if statuses.contains(.seeking) { return .seeking }
        if statuses.allSatisfy({ $0 == .unavailable }) { return .unavailable }
        return .open
    }

    // MARK: - Agenda (List mode)

    struct AgendaSessionEntry: Identifiable, Hashable {
        var session: Session
        /// The year to route to — from the session's own date, never a series lookup.
        var year: Int
        var status: SessionMemberStatus
        var id: String { session.id }
    }

    struct AgendaDay: Identifiable, Hashable {
        var date: String
        var sessions: [AgendaSessionEntry]
        var id: String { date }
    }

    /// Chronological day buckets from `fromDate`, `days` calendar days long,
    /// one per day that actually has a bookable session — days with none
    /// (including every weekend day) are omitted rather than shown empty.
    static func buildAgenda(from fromDate: String, days: Int, sessions: [Session], entries: [Entry]) -> [AgendaDay] {
        var result: [AgendaDay] = []
        for i in 0..<max(days, 0) {
            let date = NZDate.addingDays(i, to: fromDate)
            let daySessions = bookableSessions(on: date, in: sessions).sorted { $0.id < $1.id }
            if daySessions.isEmpty { continue }
            result.append(AgendaDay(
                date: date,
                sessions: daySessions.map {
                    AgendaSessionEntry(session: $0, year: $0.year, status: sessionMemberStatus($0, entries: entries))
                }
            ))
        }
        return result
    }

    // MARK: - Month grid

    struct MonthDayCell: Identifiable, Hashable {
        var date: String
        var dayOfMonth: Int
        var status: DayStatus
        /// That day's bookable sessions — empty for a `none` day.
        var sessions: [Session]
        var id: String { date }
    }

    /// One calendar week, Monday…Friday; nil for a slot outside the month
    /// (padding only — there is never a weekend column).
    typealias MonthWeek = [MonthDayCell?]

    private static let weekdayColumn: [Weekday: Int] = [
        .monday: 0, .tuesday: 1, .wednesday: 2, .thursday: 3, .friday: 4,
    ]

    private static func daysInMonth(year: Int, month: Int) -> Int {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 0)!
        let comps = DateComponents(year: year, month: month, day: 1)
        guard let first = cal.date(from: comps),
              let range = cal.range(of: .day, in: .month, for: first) else { return 30 }
        return range.count
    }

    static func isoDate(year: Int, month: Int, day: Int) -> String {
        String(format: "%04d-%02d-%02d", year, month, day)
    }

    /// `year`/`month` (1–12) as Mon–Fri weeks — no weekend columns at all.
    /// Leading/trailing slots outside the month are nil, so day 1 lands in
    /// its true weekday column and the last week is padded to five.
    static func buildMonthGrid(
        year: Int,
        month: Int,
        sessions: [Session],
        entries: [Entry],
        today: String = NZDate.today()
    ) -> [MonthWeek] {
        var cells: [MonthDayCell?] = []

        let firstWeekday = NZDate.weekday(of: isoDate(year: year, month: month, day: 1))
        let leadingBlanks = firstWeekday.flatMap { weekdayColumn[$0] } ?? 0
        cells.append(contentsOf: Array(repeating: nil, count: leadingBlanks))

        for day in 1...daysInMonth(year: year, month: month) {
            let date = isoDate(year: year, month: month, day: day)
            guard NZDate.weekday(of: date) != nil else { continue } // Saturday/Sunday: no cell at all.
            cells.append(MonthDayCell(
                date: date,
                dayOfMonth: day,
                status: dayStatus(date, sessions: sessions, entries: entries, today: today),
                sessions: bookableSessions(on: date, in: sessions)
            ))
        }

        while cells.count % 5 != 0 { cells.append(nil) }

        return stride(from: 0, to: cells.count, by: 5).map { Array(cells[$0..<$0 + 5]) }
    }

    // MARK: - Year overview

    struct YearMonthOverview: Identifiable, Hashable {
        /// 1–12.
        var month: Int
        var weeks: [MonthWeek]
        var id: Int { month }
    }

    /// A month spans at most 6 distinct Mon–Fri weeks; the year view pads
    /// every month to this many rows so the twelve mini-months line up.
    static let yearViewWeekRows = 6

    private static let blankWeek: MonthWeek = [nil, nil, nil, nil, nil]

    /// Every month of `year` as `buildMonthGrid` would build it alone,
    /// padded to `yearViewWeekRows` rows (year view only).
    static func buildYearOverview(
        year: Int,
        sessions: [Session],
        entries: [Entry],
        today: String = NZDate.today()
    ) -> [YearMonthOverview] {
        (1...12).map { month in
            var weeks = buildMonthGrid(year: year, month: month, sessions: sessions, entries: entries, today: today)
            while weeks.count < yearViewWeekRows { weeks.append(blankWeek) }
            return YearMonthOverview(month: month, weeks: weeks)
        }
    }
}

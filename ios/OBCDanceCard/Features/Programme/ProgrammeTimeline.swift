//
//  ProgrammeTimeline.swift
//  Pure grouping/ordering for the programme browser — a 1:1 port of
//  `web/src/lib/programmeView.ts`. A series renders as one card (all its
//  session dates inside), while Holiday-Bridge / No-Bridge singles are
//  interleaved between series cards by date, mirroring how the printed
//  booklet lays a weekday's page out — not bucketed into a separate
//  "singles" section.
//

import Foundation

enum WeekdayTimelineItem: Identifiable {
    case series(Series, sessions: [Session], anchorDate: String)
    case single(Session, anchorDate: String)

    var anchorDate: String {
        switch self {
        case let .series(_, _, date), let .single(_, date): return date
        }
    }

    /// The programme year (plan §21 B3) — from the series' tag or the
    /// session's own date.
    var year: Int {
        switch self {
        case let .series(series, _, _): return series.year
        case let .single(session, _): return session.year
        }
    }

    /// True when nothing on this item is still to come (NZ today). A series
    /// counts as past only when *every* session on it is.
    func isPast(today: String = NZDate.today()) -> Bool {
        switch self {
        case let .single(session, _): return session.date < today
        case let .series(_, sessions, _): return !sessions.isEmpty && sessions.allSatisfy { $0.date < today }
        }
    }

    /// Year-qualified: two years' series can share a `seriesId`.
    var id: String {
        switch self {
        case let .series(series, _, _): return "series:\(series.year):\(series.id)"
        case let .single(session, _): return "single:\(session.id)"
        }
    }
}

enum ProgrammeTimeline {
    /// Builds one weekday's timeline: series cards and single sessions, in
    /// date order. Mirrors `buildWeekdayTimeline`.
    static func build(weekday: Weekday, series: [Series], sessions: [Session]) -> [WeekdayTimelineItem] {
        var items: [WeekdayTimelineItem] = []

        // A series' sessions attach only when *both* `seriesId` and `year`
        // match — `seriesId` is `${weekday}-${slug(name)}` and two years'
        // series can share one (plan §21 B3).
        let seriesForWeekday = series
            .filter { $0.weekday == weekday }
            .sorted { ($0.year, $0.order) < ($1.year, $1.order) }
        for s in seriesForWeekday {
            let seriesSessions = sessions
                .filter { $0.seriesId == s.id && $0.year == s.year }
                .sorted { $0.date < $1.date }
            guard let firstDate = seriesSessions.first?.date else { continue }
            items.append(.series(s, sessions: seriesSessions, anchorDate: firstDate))
        }

        for session in sessions where session.weekday == weekday && session.seriesId == nil {
            items.append(.single(session, anchorDate: session.date))
        }

        return items.sorted { $0.anchorDate < $1.anchorDate }
    }

    /// Today's weekday (NZ) if it's Mon–Fri, else Monday — the programme
    /// browser's default tab. Mirrors `defaultProgrammeWeekday`.
    static func defaultWeekday(now: Date = Date()) -> Weekday {
        NZDate.weekday(of: NZDate.today(now)) ?? .monday
    }

    /// Weekdays that actually have programme data, in `Weekday.allCases`
    /// order. Mirrors `weekdaysWithData`.
    static func weekdaysWithData(_ weekdayIds: [Weekday]) -> [Weekday] {
        let present = Set(weekdayIds)
        return Weekday.allCases.filter { present.contains($0) }
    }
}

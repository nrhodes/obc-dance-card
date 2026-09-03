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

    var id: String {
        switch self {
        case let .series(series, _, _): return "series:\(series.id)"
        case let .single(session, _): return "single:\(session.id)"
        }
    }
}

enum ProgrammeTimeline {
    /// Builds one weekday's timeline: series cards and single sessions, in
    /// date order. Mirrors `buildWeekdayTimeline`.
    static func build(weekday: Weekday, series: [Series], sessions: [Session]) -> [WeekdayTimelineItem] {
        var items: [WeekdayTimelineItem] = []

        let seriesForWeekday = series.filter { $0.weekday == weekday }.sorted { $0.order < $1.order }
        for s in seriesForWeekday {
            let seriesSessions = sessions.filter { $0.seriesId == s.id }.sorted { $0.date < $1.date }
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

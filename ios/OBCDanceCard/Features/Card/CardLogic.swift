//
//  CardLogic.swift
//  Pure "My Dance Card" grouping + status-label logic — a 1:1 port of
//  `web/src/lib/card.ts` (plan §5.6, §7). Kept out of the view so every
//  status/substitution shape is unit-testable.
//
//  Status wording deliberately does not repeat "You:" (unlike
//  `Roster.describeOwnEntry`, used on the shared session page where the line
//  has to be picked out from other members' rows) — every row on this screen
//  is already the signed-in member's own, so the status text alone ("with X",
//  "Looking for a partner", …) reads naturally.
//

import Foundation

struct CardRow: Identifiable, Hashable {
    var entry: Entry
    var title: String
    var date: String
    var statusText: String
    /// True for a Teams-series entry — the row shows a "Team" badge.
    var isTeam: Bool

    var id: String { entry.id }
}

struct CardGroup: Identifiable, Hashable {
    /// `seriesId`, or `single:{sessionId}` for a standalone session.
    var key: String
    var title: String
    var rows: [CardRow]

    var id: String { key }
}

struct CardWeekdayGroup: Identifiable, Hashable {
    var weekday: Weekday
    var label: String
    var groups: [CardGroup]

    var id: String { weekday.rawValue }
}

enum CardLogic {
    /// True for any entry that still occupies a place on the card (plan §5.6
    /// status list, minus `cancelled`). Mirrors `isActiveCardEntry`.
    static func isActive(_ entry: Entry) -> Bool {
        EntryStatus.active.contains(entry.status)
    }

    /// One line's status text, e.g. `"with John Smith"`, `"with Bob Visitor
    /// (visitor)"`, `"with John Smith — sub: Amy Lee for John Smith"`,
    /// `"with John Smith — you're covered by Amy Lee"`, `"Looking for a
    /// partner"`, `"Available"`, or a team's name.
    /// Mirrors `describeCardStatus`.
    static func describeStatus(_ entry: Entry, teams: [Team] = []) -> String {
        if let teamId = entry.teamId {
            return teams.first(where: { $0.id == teamId })?.name ?? "On a team"
        }
        if entry.status == .lookingForPartner { return "Looking for a partner" }
        if entry.status == .available { return "Available" }
        if entry.status == .confirmed, let partner = entry.partner {
            var text = "with \(partner.displayName)"
            if partner.kind == .visitor { text += " (visitor)" }
            if let sub = entry.partnerSubstitute {
                text += " — sub: \(sub.displayName) for \(partner.displayName)"
            }
            return text
        }
        if entry.status == .substituted {
            if let partner = entry.partner, let sub = entry.substitute {
                return "with \(partner.displayName) — you're covered by \(sub.displayName)"
            }
            return "Substituted"
        }
        return "Confirmed"
    }

    /// The title for one entry's session: the session's own title, or its
    /// series name as a fallback. Mirrors `cardSessionTitle`.
    /// A series lookup is year-qualified from the *entry's own date*:
    /// `seriesId` can collide across published years (plan §21 B3). A
    /// series carrying no year tag (`year == 0`, e.g. a single-year fixture)
    /// always matches, preserving the pre-B3 behaviour.
    private static func seriesDoc(for entry: Entry, in series: [Series]) -> Series? {
        guard let seriesId = entry.seriesId else { return nil }
        return series.first { $0.id == seriesId && ($0.year == 0 || $0.year == entry.year) }
    }

    static func sessionTitle(_ entry: Entry, sessions: [Session], series: [Series]) -> String {
        if let session = sessions.first(where: { $0.id == entry.sessionId }) { return session.title }
        if let s = seriesDoc(for: entry, in: series) { return s.name }
        return "Session"
    }

    private static func toRow(_ entry: Entry, sessions: [Session], series: [Series], teams: [Team]) -> CardRow {
        CardRow(
            entry: entry,
            title: sessionTitle(entry, sessions: sessions, series: series),
            date: entry.date,
            statusText: describeStatus(entry, teams: teams),
            isTeam: entry.teamId != nil
        )
    }

    /// Groups the member's upcoming entries by weekday (Mon→Fri order), then
    /// by series (or standalone session) within each weekday, with rows in
    /// date order. Cancelled entries are dropped — they no longer occupy a
    /// place on the card. Mirrors `groupCardEntries`.
    static func groupEntries(
        entries: [Entry],
        sessions: [Session],
        series: [Series],
        weekdays: [WeekdayProgramme],
        teams: [Team] = []
    ) -> [CardWeekdayGroup] {
        let active = entries.filter(isActive)
        var byWeekday: [Weekday: [Entry]] = [:]
        for e in active { byWeekday[e.weekday, default: []].append(e) }

        var result: [CardWeekdayGroup] = []
        for wd in Weekday.allCases {
            guard let list = byWeekday[wd], !list.isEmpty else { continue }

            // The grouping key is year-qualified from the entry's own date —
            // two entries in different years' identically-slugged series
            // must never land in one group (plan §21 B3).
            var bySeries: [String: [Entry]] = [:]
            var order: [String] = []
            for e in list {
                let key = e.seriesId.map { "\(e.year):\($0)" } ?? "single:\(e.sessionId)"
                if bySeries[key] == nil { order.append(key) }
                bySeries[key, default: []].append(e)
            }

            var groups: [CardGroup] = []
            for key in order {
                let sorted = (bySeries[key] ?? []).sorted { $0.date < $1.date }
                guard let first = sorted.first else { continue }
                let seriesDoc = seriesDoc(for: first, in: series)
                let title = seriesDoc?.name ?? sessionTitle(first, sessions: sessions, series: series)
                groups.append(CardGroup(
                    key: key,
                    title: title,
                    rows: sorted.map { toRow($0, sessions: sessions, series: series, teams: teams) }
                ))
            }
            groups.sort { ($0.rows.first?.date ?? "") < ($1.rows.first?.date ?? "") }

            let label = weekdays.first(where: { $0.weekday == wd })?.label ?? wd.rawValue.capitalized
            result.append(CardWeekdayGroup(weekday: wd, label: label, groups: groups))
        }
        return result
    }

    /// Flat, most-recent-first rows for the collapsed "Past" section.
    /// Mirrors `buildPastRows`.
    static func pastRows(
        entries: [Entry],
        sessions: [Session],
        series: [Series],
        teams: [Team] = []
    ) -> [CardRow] {
        entries
            .filter(isActive)
            .sorted { $0.date > $1.date }
            .map { toRow($0, sessions: sessions, series: series, teams: teams) }
    }
}

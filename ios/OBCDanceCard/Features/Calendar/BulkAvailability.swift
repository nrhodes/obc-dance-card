//
//  BulkAvailability.swift
//  Pure client-side preview for the "Set availability…" bulk sheet — a 1:1
//  port of `web/src/lib/bulkAvailability.ts` (plan §21 B2). Mirrors the
//  display-relevant subset of the server's `expandBulkSoloStatusSessions`:
//  weekday match, date range clamped to today, and `kind != noBridge` —
//  enough to tell the member "this will touch N sessions, M of which are
//  already booked and will be left alone" before they confirm.
//
//  Deliberately does *not* replicate the server's session-lock check or its
//  200-session cap: the plan settles that the server enforces both and the
//  preview may say "about N".
//

import Foundation

struct BulkAvailabilityFilter: Hashable {
    var weekdays: Set<Weekday>
    var fromDate: String?
    var toDate: String?
}

struct BulkAvailabilityPreview: Equatable {
    /// Every session the filter matches (weekday + date range + bookable).
    var matched: Int
    /// Of `matched`, how many already have a booked entry and will be left untouched.
    var bookedSkipped: Int
    /// `matched - bookedSkipped` — sessions the action will actually change.
    var toUpdate: Int
}

enum BulkAvailability {
    /// The sessions the preview counts as "matched".
    static func matchingSessions(
        _ sessions: [Session],
        filter: BulkAvailabilityFilter,
        today: String = NZDate.today()
    ) -> [Session] {
        let from: String = {
            if let f = filter.fromDate, f > today { return f }
            return today
        }()
        return sessions
            .filter { filter.weekdays.contains($0.weekday) }
            .filter { $0.kind != .noBridge }
            .filter { $0.date >= from }
            .filter { s in filter.toDate.map { to in s.date <= to } ?? true }
            .sorted { a, b in a.date == b.date ? a.id < b.id : a.date < b.date }
    }

    static func preview(
        sessions: [Session],
        entries: [Entry],
        filter: BulkAvailabilityFilter,
        today: String = NZDate.today()
    ) -> BulkAvailabilityPreview {
        let matched = matchingSessions(sessions, filter: filter, today: today)
        let bookedSkipped = matched.filter { s in
            guard let e = entries.first(where: { $0.sessionId == s.id && $0.status != .cancelled }) else { return false }
            return Overview.isBookedEntry(e)
        }.count
        return BulkAvailabilityPreview(
            matched: matched.count,
            bookedSkipped: bookedSkipped,
            toUpdate: matched.count - bookedSkipped
        )
    }
}

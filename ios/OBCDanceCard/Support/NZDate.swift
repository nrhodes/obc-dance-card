//
//  NZDate.swift
//  NZ-local date/time helpers — the Swift mirror of `shared/src/time.ts`
//  (plan §6). All programme date logic must go through these: a session's
//  stored `date` is an NZ-local calendar date, and deriving "today" from a
//  UTC instant gives the wrong answer for ~12 hours a day in New Zealand.
//
//  Two different implementation strategies, matching `time.ts`'s reasoning:
//
//  * `today` formats *now* in `Pacific/Auckland` — a timezone conversion is
//    exactly what's wanted, since the input is an instant.
//  * `weekday(of:)` and `addingDays` do plain proleptic-Gregorian arithmetic
//    in UTC on the date's own year/month/day fields. The input already *is*
//    the NZ calendar date, so its weekday and its "+2 days" are timezone
//    independent; routing them through a zone conversion would shift the
//    result by a day near midnight, and the shift direction flips across the
//    NZDT/NZST boundary.
//  * `sessionCutoff` is the one place a wall-clock time must be turned into
//    an instant, so it resolves the components *in* the NZ zone and lets
//    `Calendar` handle the offset in effect on that date.
//

import Foundation

enum NZDate {
    static let timeZone = TimeZone(identifier: "Pacific/Auckland")!

    /// UTC calendar, for field arithmetic that must not be perturbed by a zone.
    private static let utcCalendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 0)!
        return cal
    }()

    private static let nzCalendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        return cal
    }()

    private static let isoDayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = timeZone
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    /// Today's calendar date in `Pacific/Auckland`, as `YYYY-MM-DD`.
    /// Mirrors `todayNZ()`.
    static func today(_ now: Date = Date()) -> String {
        isoDayFormatter.string(from: now)
    }

    /// True when `date` (an NZ-local `YYYY-MM-DD`) is strictly before today (NZ).
    /// Mirrors `isPastNZ()`.
    static func isPast(_ date: String, now: Date = Date()) -> Bool {
        date < today(now)
    }

    /// Splits `YYYY-MM-DD` into its numeric fields, or nil if malformed.
    static func components(of date: String) -> (year: Int, month: Int, day: Int)? {
        let parts = date.split(separator: "-")
        guard parts.count == 3,
              let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2])
        else { return nil }
        return (year, month, day)
    }

    /// The `Weekday` a programme date falls on. Mirrors `weekdayOfNZ()`,
    /// including its refusal to accept a weekend: the club only runs
    /// Monday–Friday, so a Saturday/Sunday date is a transcription error.
    /// Returns nil rather than throwing (the callers here are display code).
    static func weekday(of date: String) -> Weekday? {
        guard let c = components(of: date) else { return nil }
        var dc = DateComponents()
        dc.year = c.year
        dc.month = c.month
        dc.day = c.day
        guard let instant = utcCalendar.date(from: dc) else { return nil }
        // Calendar's `weekday` is 1 = Sunday … 7 = Saturday.
        switch utcCalendar.component(.weekday, from: instant) {
        case 2: return .monday
        case 3: return .tuesday
        case 4: return .wednesday
        case 5: return .thursday
        case 6: return .friday
        default: return nil
        }
    }

    /// Adds (or subtracts) whole calendar days to an NZ-local `YYYY-MM-DD`.
    /// Mirrors `addDaysNZ()`.
    static func addingDays(_ days: Int, to date: String) -> String {
        guard let c = components(of: date) else { return date }
        var dc = DateComponents()
        dc.year = c.year
        dc.month = c.month
        dc.day = c.day
        guard let start = utcCalendar.date(from: dc),
              let shifted = utcCalendar.date(byAdding: .day, value: days, to: start)
        else { return date }
        let out = utcCalendar.dateComponents([.year, .month, .day], from: shifted)
        return String(format: "%04d-%02d-%02d", out.year ?? 0, out.month ?? 0, out.day ?? 0)
    }

    /// The instant a session starting at `startTime` (`HH:MM`, 24h) on the
    /// NZ-local `date` begins — i.e. the moment the session locks (§6 / I7).
    /// Mirrors `sessionCutoff()`.
    ///
    /// Falls back to `.distantFuture` for an unparseable date/time so a
    /// malformed programme row leaves the session *open* rather than
    /// silently locking every member out of it.
    static func sessionCutoff(date: String, startTime: String) -> Date {
        guard let c = components(of: date) else { return .distantFuture }
        let timeParts = startTime.split(separator: ":")
        let hour = timeParts.count > 0 ? Int(timeParts[0]) ?? 0 : 0
        let minute = timeParts.count > 1 ? Int(timeParts[1]) ?? 0 : 0

        var dc = DateComponents()
        dc.year = c.year
        dc.month = c.month
        dc.day = c.day
        dc.hour = hour
        dc.minute = minute
        dc.second = 0
        dc.timeZone = timeZone
        return nzCalendar.date(from: dc) ?? .distantFuture
    }
}

//
//  Format.swift
//  Display formatting — the Swift mirror of `web/src/lib/format.ts`, so the
//  two clients read identically. NZ dates and times only.
//
//  `formatDate` takes a stored `IsoDate` (already an NZ-local calendar date
//  per plan §6) and renders its own year/month/day fields — it builds a UTC
//  midnight instant and formats it in `Pacific/Auckland`. Because the NZ
//  offset is always +12h or +13h (never negative, never >= 24h), that instant
//  always falls on the same calendar day in NZ, so this is safe year-round
//  including across DST transitions.
//

import Foundation

enum Fmt {
    private static let nzLocale = Locale(identifier: "en_NZ")

    /// A *fixed* pattern, not `setLocalizedDateFormatFromTemplate` — the
    /// localised en_NZ arrangement of the same fields renders "Mon, 11 Jan
    /// 2027", and the web app's `formatDateNZ` assembles the parts itself as
    /// "Mon 11 Jan 2027". The two clients must read identically, so the
    /// pattern is pinned rather than left to the locale.
    private static let dayLabelFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = nzLocale
        f.timeZone = NZDate.timeZone
        f.dateFormat = "EEE d MMM yyyy"
        return f
    }()

    private static let dateTimeLabelFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = nzLocale
        f.timeZone = NZDate.timeZone
        f.dateStyle = .medium
        f.timeStyle = .short
        return f
    }()

    private static let isoInstantFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoInstantNoFractionFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private static let utcCalendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 0)!
        return cal
    }()

    /// `"2027-01-11"` -> `"Mon 11 Jan 2027"`. Mirrors `formatDateNZ`.
    static func date(_ isoDate: String) -> String {
        guard let c = NZDate.components(of: isoDate) else { return isoDate }
        var dc = DateComponents()
        dc.year = c.year
        dc.month = c.month
        dc.day = c.day
        guard let instant = utcCalendar.date(from: dc) else { return isoDate }
        return dayLabelFormatter.string(from: instant)
    }

    /// `"13:00"` -> `"1:00pm"`; `"07:00"` -> `"7:00am"`. Falls back to the raw
    /// value if unparseable. Mirrors `formatTimeOfDay`.
    static func timeOfDay(_ time: String) -> String {
        let trimmed = time.trimmingCharacters(in: .whitespaces)
        let parts = trimmed.split(separator: ":")
        guard parts.count == 2,
              let hour24 = Int(parts[0]), (0...23).contains(hour24),
              parts[1].count == 2, Int(parts[1]) != nil
        else { return time }
        let period = hour24 < 12 ? "am" : "pm"
        let hour12 = hour24 % 12 == 0 ? 12 : hour24 % 12
        return "\(hour12):\(parts[1])\(period)"
    }

    /// Formats a full ISO instant (e.g. an invite's `expiresAt`) as an
    /// NZ-local date + time. Mirrors `formatDateTimeNZ`.
    static func dateTime(_ iso: String) -> String {
        guard let instant = parseInstant(iso) else { return iso }
        return dateTimeLabelFormatter.string(from: instant)
    }

    /// Parses either `2027-01-12T00:00:00.000Z` or `2027-01-12T00:00:00Z`.
    static func parseInstant(_ iso: String) -> Date? {
        isoInstantFormatter.date(from: iso) ?? isoInstantNoFractionFormatter.date(from: iso)
    }

    /// `"3 sessions"` / `"1 session"` — the plural rule used all over the
    /// invite and series copy.
    static func pluralised(_ count: Int, _ singular: String) -> String {
        "\(count) \(singular)\(count == 1 ? "" : "s")"
    }
}

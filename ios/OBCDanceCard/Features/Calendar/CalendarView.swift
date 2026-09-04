//
//  CalendarView.swift
//  Calendar overview — the counterpart of `web/src/screens/CalendarScreen.tsx`
//  (plan §21 B4), plus the B2 "Set availability…" bulk action. Three modes —
//  List (default), Month, Year — all built from the same two live sources
//  every other screen uses: `ProgrammeStore` (published sessions across the
//  loaded years) and `MyEntriesStore` (the member's own entries, shared with
//  My Card). The Month and especially Year views exist to make `open` days —
//  a bookable session the member has no relationship with yet — easy to spot.
//
//  Every day cell's status is colour *and* a letter glyph (never colour
//  alone, WCAG 1.4.1), and the legend spells each one out in words. The
//  colours are the web's validated palette (`styles.css`
//  `--color-status-*`), so the two clients read identically.
//
//  Year-view cells are deliberately smaller than the app's usual 44pt
//  target — twelve Mon–Fri months don't otherwise fit on a phone. A conscious
//  exception for this one dense "spot the pattern" view; the Month view keeps
//  full-size cells.
//

import SwiftUI

// MARK: - Palette (web `styles.css` --color-status-*, contrast-validated)

private extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

private struct DayStatusMeta {
    let label: String
    let glyph: String
    let background: Color
    let foreground: Color
}

private func meta(for status: DayStatus) -> DayStatusMeta {
    switch status {
    case .none:        return DayStatusMeta(label: "No session", glyph: "", background: Color(.systemBackground), foreground: .secondary)
    case .booked:      return DayStatusMeta(label: "Booked", glyph: "B", background: Color(hex: 0x52b788), foreground: Color(hex: 0x03301c))
    case .partly:      return DayStatusMeta(label: "Partly booked", glyph: "P", background: Color(hex: 0xd8f3dc), foreground: Color(hex: 0x1b4332))
    case .seeking:     return DayStatusMeta(label: "Seeking a partner", glyph: "S", background: Color(hex: 0xb197fc), foreground: Color(hex: 0x2a1058))
    case .unavailable: return DayStatusMeta(label: "Unavailable", glyph: "U", background: Color(hex: 0x3f3f46), foreground: Color(hex: 0xf4f4f5))
    case .open:        return DayStatusMeta(label: "Open — you could book", glyph: "O", background: Color(hex: 0xff9838), foreground: Color(hex: 0x4a2500))
    }
}

private func meta(for status: SessionMemberStatus) -> DayStatusMeta {
    switch status {
    case .booked: return meta(for: DayStatus.booked)
    case .seeking: return meta(for: DayStatus.seeking)
    case .unavailable: return meta(for: DayStatus.unavailable)
    case .open: return meta(for: DayStatus.open)
    }
}

private let legendStatuses: [DayStatus] = [.booked, .partly, .seeking, .open, .unavailable]
private let monthNames = ["January", "February", "March", "April", "May", "June",
                          "July", "August", "September", "October", "November", "December"]
private let weekdayHeader = ["Mon", "Tue", "Wed", "Thu", "Fri"]

// MARK: - Screen

struct CalendarView: View {
    private enum Mode: String, CaseIterable, Identifiable {
        case list = "List", month = "Month", year = "Year"
        var id: String { rawValue }
    }

    private static let listPageDays = 14

    @EnvironmentObject private var programme: ProgrammeStore
    @EnvironmentObject private var myEntries: MyEntriesStore
    @EnvironmentObject private var router: Router

    @State private var mode: Mode = .list
    @State private var daysShown = listPageDays
    @State private var anchorDate: String?
    @State private var viewYear: Int = 0
    @State private var viewMonth: Int = 0
    @State private var yearViewYear: Int = 0
    @State private var showingBulk = false
    @State private var bulkNotice: String?

    private var today: String { NZDate.today() }
    private var currentYear: Int { Int(today.prefix(4)) ?? 0 }
    private var currentMonth: Int { Int(today.dropFirst(5).prefix(2)) ?? 1 }
    private var years: [Int] { programme.years.sorted() }
    private var minYear: Int { years.first ?? currentYear }
    private var maxYear: Int { years.last ?? currentYear }
    private var horizonEnd: String { "\(maxYear)-12-31" }
    private var loading: Bool { programme.loading || myEntries.loading }

    var body: some View {
        Group {
            if loading {
                ProgressView("Loading…")
            } else {
                content
            }
        }
        .navigationTitle("Calendar")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Set availability…") { showingBulk = true }
            }
        }
        .onAppear(perform: correctYears)
        .onChange(of: programme.years) { _, _ in correctYears() }
        .sheet(isPresented: $showingBulk) {
            SetAvailabilitySheet(
                sessions: programme.sessions,
                entries: myEntries.entries,
                defaultToDate: horizonEnd
            ) { notice in
                bulkNotice = notice
            }
        }
    }

    /// Once the published years load, make sure Month/Year point at a loaded year.
    private func correctYears() {
        guard !years.isEmpty else { return }
        let preferred = years.contains(currentYear) ? currentYear : years[0]
        if !years.contains(viewYear) { viewYear = preferred; viewMonth = viewYear == currentYear ? currentMonth : 1 }
        if !years.contains(yearViewYear) { yearViewYear = preferred }
    }

    private var content: some View {
        VStack(spacing: 0) {
            Picker("Calendar view", selection: $mode) {
                ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.bottom, 8)

            List {
                if let error = programme.error ?? myEntries.error {
                    Section { Text(error.message).foregroundStyle(.secondary) }
                }
                if let bulkNotice {
                    Section { Text(bulkNotice).foregroundStyle(.green) }
                }
                switch mode {
                case .list: listSections
                case .month: monthSections
                case .year: yearSections
                }
            }
            .listStyle(.insetGrouped)
        }
    }

    // MARK: List

    @ViewBuilder
    private var listSections: some View {
        let from = anchorDate ?? today
        let agenda = Overview.buildAgenda(from: from, days: daysShown, sessions: programme.sessions, entries: myEntries.entries)
        let lastShown = NZDate.addingDays(daysShown - 1, to: from)

        if let anchorDate {
            Section {
                HStack {
                    Text("Showing from \(Fmt.date(anchorDate)).").foregroundStyle(.secondary)
                    Spacer()
                    Button("Back to today") { self.anchorDate = nil }
                }
            }
        }
        if agenda.isEmpty {
            Section { Text("No sessions in the next \(daysShown) days.").foregroundStyle(.secondary) }
        }
        ForEach(agenda) { day in
            Section(Fmt.date(day.date)) {
                ForEach(day.sessions) { item in
                    Button {
                        router.openSession(year: item.year, sessionId: item.session.id, from: .calendar)
                    } label: {
                        HStack {
                            Text(item.session.title)
                            Spacer()
                            StatusPill(meta: meta(for: item.status))
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        if lastShown < horizonEnd {
            Section {
                Button("Show more") { daysShown += Self.listPageDays }
            }
        }
    }

    // MARK: Month

    @ViewBuilder
    private var monthSections: some View {
        let weeks = Overview.buildMonthGrid(year: viewYear, month: viewMonth, sessions: programme.sessions, entries: myEntries.entries, today: today)
        Section {
            HStack {
                Button { prevMonth() } label: { Label("Previous month", systemImage: "chevron.left").labelStyle(.iconOnly) }
                    .disabled(viewYear == minYear && viewMonth == 1)
                Spacer()
                Text("\(monthNames[max(0, min(11, viewMonth - 1))]) \(String(viewYear))")
                    .font(.headline)
                    .minimumScaleFactor(0.7)
                Spacer()
                Button { nextMonth() } label: { Label("Next month", systemImage: "chevron.right").labelStyle(.iconOnly) }
                    .disabled(viewYear == maxYear && viewMonth == 12)
            }
            .buttonStyle(.bordered)

            MonthGrid(weeks: weeks, today: today, compact: false, onSelect: handleDayCell)
        }
        Section("Legend") { Legend() }
    }

    private func prevMonth() {
        if viewYear == minYear && viewMonth == 1 { return }
        if viewMonth == 1 { viewYear -= 1; viewMonth = 12 } else { viewMonth -= 1 }
    }

    private func nextMonth() {
        if viewYear == maxYear && viewMonth == 12 { return }
        if viewMonth == 12 { viewYear += 1; viewMonth = 1 } else { viewMonth += 1 }
    }

    // MARK: Year

    @ViewBuilder
    private var yearSections: some View {
        let overview = Overview.buildYearOverview(year: yearViewYear, sessions: programme.sessions, entries: myEntries.entries, today: today)
        Section {
            Picker("Year", selection: $yearViewYear) {
                ForEach(years, id: \.self) { Text(String($0)).tag($0) }
            }
            .pickerStyle(.segmented)
        }
        Section {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                ForEach(overview) { month in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(monthNames[month.month - 1]).font(.subheadline.weight(.semibold))
                        MonthGrid(weeks: month.weeks, today: today, compact: true, onSelect: handleDayCell)
                    }
                }
            }
            .padding(.vertical, 4)
        }
        Section("Legend") { Legend() }
    }

    /// A single-session day opens that session; a multi-session day (or any
    /// Year-view cell) jumps to List anchored at that date.
    private func handleDayCell(_ cell: Overview.MonthDayCell) {
        guard !cell.sessions.isEmpty else { return }
        if cell.sessions.count == 1, mode == .month, let session = cell.sessions.first {
            router.openSession(year: session.year, sessionId: session.id, from: .calendar)
            return
        }
        anchorDate = cell.date
        daysShown = Self.listPageDays
        mode = .list
    }
}

// MARK: - Pieces

private struct StatusPill: View {
    let meta: DayStatusMeta
    var body: some View {
        HStack(spacing: 4) {
            Text(meta.glyph).bold().accessibilityHidden(true)
            Text(meta.label)
        }
        .font(.caption)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(meta.background, in: Capsule())
        .foregroundStyle(meta.foreground)
        .accessibilityLabel(meta.label)
    }
}

private struct MonthGrid: View {
    let weeks: [Overview.MonthWeek]
    let today: String
    let compact: Bool
    let onSelect: (Overview.MonthDayCell) -> Void

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: compact ? 2 : 6), count: 5)
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: compact ? 2 : 6) {
            ForEach(weekdayHeader, id: \.self) { label in
                Text(compact ? String(label.prefix(1)) : label)
                    .font(compact ? .caption2 : .caption)
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            ForEach(Array(weeks.enumerated()), id: \.offset) { _, week in
                ForEach(Array(week.enumerated()), id: \.offset) { _, cell in
                    DayCell(cell: cell, today: today, compact: compact, onSelect: onSelect)
                }
            }
        }
    }
}

private struct DayCell: View {
    let cell: Overview.MonthDayCell?
    let today: String
    let compact: Bool
    let onSelect: (Overview.MonthDayCell) -> Void

    var body: some View {
        if let cell {
            let m = meta(for: cell.status)
            let isToday = cell.date == today
            Button { onSelect(cell) } label: {
                VStack(spacing: 0) {
                    Text(String(cell.dayOfMonth)).font(compact ? .caption2 : .body)
                    if !compact {
                        Text(m.glyph.isEmpty ? " " : m.glyph).font(.caption.bold())
                    }
                }
                .frame(maxWidth: .infinity, minHeight: compact ? 22 : 48)
                .background(m.background, in: RoundedRectangle(cornerRadius: compact ? 3 : 6))
                .foregroundStyle(m.foreground)
                .overlay(
                    RoundedRectangle(cornerRadius: compact ? 3 : 6)
                        .strokeBorder(isToday ? Color.accentColor : .clear, lineWidth: 2)
                )
            }
            .buttonStyle(.plain)
            .disabled(cell.sessions.isEmpty)
            .accessibilityLabel("\(Fmt.date(cell.date))\(isToday ? ", today" : "") — \(m.label)")
        } else {
            Color.clear.frame(maxWidth: .infinity, minHeight: compact ? 22 : 48)
                .accessibilityHidden(true)
        }
    }
}

private struct Legend: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(legendStatuses, id: \.self) { status in
                let m = meta(for: status)
                HStack(spacing: 8) {
                    Text(m.glyph)
                        .font(.caption.bold())
                        .frame(width: 24, height: 24)
                        .background(m.background, in: RoundedRectangle(cornerRadius: 4))
                        .foregroundStyle(m.foreground)
                        .accessibilityHidden(true)
                    Text(m.label)
                }
            }
        }
    }
}

// MARK: - Set availability (plan §21 B2)

/// Mark yourself available/unavailable — or clear either — across every
/// matching session in one go, filtered by weekday and a date range. The
/// live preview mirrors the server's filtering (weekday, range clamped to
/// today, bookable, booked-never-touched) but not its lock check or 200-cap,
/// so it says "about N". Copy is word-for-word with the web dialog.
struct SetAvailabilitySheet: View {
    let sessions: [Session]
    let entries: [Entry]
    let defaultToDate: String
    let onDone: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var status: BulkAvailabilityStatus = .available
    @State private var weekdays: Set<Weekday> = []
    @State private var fromDate: Date = Date()
    @State private var toDate: Date = Date()
    @State private var busy = false
    @State private var errorMessage: String?

    private static let options: [(BulkAvailabilityStatus, String, String)] = [
        (.available, "Available", "Show me as free on the noticeboard — anyone can invite me."),
        (.unavailable, "Unavailable", "Don't show me as free and don't let others invite me."),
        (.clear, "Clear", "Remove any noticeboard listing or unavailable marker — back to nothing set."),
    ]

    private var fromIso: String { Self.iso(fromDate) }
    private var toIso: String { Self.iso(toDate) }
    private var rangeValid: Bool { fromIso <= toIso }
    private var canConfirm: Bool { !weekdays.isEmpty && rangeValid && !busy }
    private var statusLabel: String { status == .clear ? "cleared" : status.rawValue }

    private var preview: BulkAvailabilityPreview? {
        guard !weekdays.isEmpty, rangeValid else { return nil }
        return BulkAvailability.preview(
            sessions: sessions, entries: entries,
            filter: BulkAvailabilityFilter(weekdays: weekdays, fromDate: fromIso, toDate: toIso)
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
                Section("Status") {
                    ForEach(Self.options, id: \.0) { value, label, blurb in
                        Button {
                            status = value
                        } label: {
                            HStack(alignment: .top) {
                                Image(systemName: status == value ? "largecircle.fill.circle" : "circle")
                                    .foregroundStyle(status == value ? Color.accentColor : .secondary)
                                    .accessibilityHidden(true)
                                VStack(alignment: .leading) {
                                    Text(label).font(.body.weight(.semibold))
                                    Text(blurb).font(.subheadline).foregroundStyle(.secondary)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(status == value ? .isSelected : [])
                    }
                }
                Section("Weekdays") {
                    ForEach(Weekday.allCases, id: \.self) { wd in
                        Toggle(wd.rawValue.capitalized, isOn: Binding(
                            get: { weekdays.contains(wd) },
                            set: { on in if on { weekdays.insert(wd) } else { weekdays.remove(wd) } }
                        ))
                    }
                }
                Section {
                    DatePicker("From", selection: $fromDate, displayedComponents: .date)
                    DatePicker("To", selection: $toDate, displayedComponents: .date)
                    if !rangeValid {
                        Text("The from date must be on or before the to date.").foregroundStyle(.red)
                    }
                }
                Section {
                    Text(previewText).foregroundStyle(.secondary)
                }
                Section {
                    Button(busy ? "Working…" : "Confirm") { Task { await confirm() } }
                        .disabled(!canConfirm)
                }
            }
            .environment(\.timeZone, NZDate.timeZone)
            .navigationTitle("Set availability")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
            }
            .onAppear {
                fromDate = Self.date(NZDate.today()) ?? Date()
                toDate = Self.date(defaultToDate) ?? Date()
            }
        }
    }

    private var previewText: String {
        if weekdays.isEmpty { return "Choose at least one weekday to see a preview." }
        if !rangeValid { return "" }
        guard let p = preview else { return "" }
        if p.bookedSkipped > 0 {
            return "This will mark about \(Fmt.pluralised(p.toUpdate, "session")) as \(statusLabel). "
                + "\(Fmt.pluralised(p.bookedSkipped, "booked session")) will not be changed."
        }
        return "This will mark about \(Fmt.pluralised(p.toUpdate, "session")) as \(statusLabel)."
    }

    private func confirm() async {
        busy = true
        errorMessage = nil
        do {
            let result = try await Api.setBulkSoloStatus(
                status: status, weekdays: Weekday.allCases.filter { weekdays.contains($0) },
                fromDate: fromIso, toDate: toIso
            )
            var summary = "Marked \(Fmt.pluralised(result.updated, "session")) as \(statusLabel)."
            if !result.skipped.isEmpty {
                summary += " Kept your bookings on: " + result.skipped.map { Fmt.date($0.date) }.joined(separator: ", ") + "."
            }
            busy = false
            onDone(summary)
            dismiss()
        } catch {
            errorMessage = ErrorMapper.action(error)
            busy = false
        }
    }

    // NZ-local calendar date <-> ISO, so a picker set on any device shows the
    // same day the server will act on.
    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = NZDate.timeZone
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    private static func iso(_ d: Date) -> String { formatter.string(from: d) }
    private static func date(_ iso: String) -> Date? { formatter.date(from: iso) }
}

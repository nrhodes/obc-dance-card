//
//  ProgrammeView.swift
//  Programme browser — the counterpart of `web/src/screens/ProgrammeScreen.tsx`
//  (plan §5.4, §14.2, §21 B3). Members only ever see *published* programmes:
//  `ProgrammeStore` subscribes to the newest few published years and merges
//  them into one chronological, year-tagged view; drafts are invisible to
//  members at the rules layer.
//
//  Plan §21 B3: the timeline spans every loaded year, and past sessions /
//  fully-past series are hidden by default behind "Show earlier sessions" —
//  rendered only when something is actually hidden, since a button that
//  visibly does nothing is confusing (§14.1's forgiving-UI intent).
//
//  A series renders as one card with all its dates inside; Holiday-Bridge and
//  No-Bridge singles are interleaved by date, mirroring the printed booklet.
//

import SwiftUI

struct ProgrammeView: View {
    @EnvironmentObject private var programme: ProgrammeStore
    @EnvironmentObject private var directory: MembersDirectoryStore
    @EnvironmentObject private var router: Router

    @State private var activeWeekday: Weekday = ProgrammeTimeline.defaultWeekday()
    @State private var pastOpen = false

    private var presentWeekdays: [Weekday] {
        ProgrammeTimeline.weekdaysWithData(programme.weekdays.map(\.weekday))
    }

    private var timeline: [WeekdayTimelineItem] {
        ProgrammeTimeline.build(weekday: activeWeekday, series: programme.series, sessions: programme.sessions)
    }

    /// Oldest first, e.g. "2026 & 2027 Programme".
    private var heading: String {
        let ys = programme.years.sorted().map(String.init)
        return ys.isEmpty ? "Programme" : "\(ys.joined(separator: " & ")) Programme"
    }

    var body: some View {
        Group {
            if programme.loading {
                ProgressView("Loading…")
            } else if let error = programme.error {
                ContentUnavailableView("Programme", systemImage: "exclamationmark.triangle", description: Text(error.message))
            } else if programme.years.isEmpty {
                ContentUnavailableView(
                    "Not published yet",
                    systemImage: "calendar",
                    description: Text("The programme hasn't been published yet.")
                )
            } else {
                content
            }
        }
        .navigationTitle(heading)
        .onAppear(perform: correctInitialWeekday)
        .onChange(of: presentWeekdays) { _, _ in correctInitialWeekday() }
    }

    private var content: some View {
        let today = NZDate.today()
        let all = timeline
        let hiddenPastCount = all.filter { $0.isPast(today: today) }.count
        let visible = pastOpen ? all : all.filter { !$0.isPast(today: today) }

        return VStack(spacing: 0) {
            Picker("Weekday", selection: $activeWeekday) {
                ForEach(presentWeekdays, id: \.self) { weekday in
                    Text(weekday.shortLabel).tag(weekday)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.bottom, 8)
            .accessibilityLabel("Weekday")

            List {
                // Newest year first in the store, so the first match prefers
                // the newest year's weekday doc.
                if let weekdayDoc = programme.weekday(activeWeekday) {
                    Section { weekdayInfo(weekdayDoc) }
                }

                if hiddenPastCount > 0 {
                    Section {
                        Button(pastOpen ? "Hide earlier sessions" : "Show earlier sessions") {
                            withAnimation { pastOpen.toggle() }
                        }
                    }
                }

                if all.isEmpty {
                    Section { Text("No sessions scheduled for this weekday.").foregroundStyle(.secondary) }
                } else if visible.isEmpty {
                    Section { Text("No upcoming sessions for this weekday.").foregroundStyle(.secondary) }
                }

                ForEach(visible) { item in
                    switch item {
                    case let .series(series, sessions, _):
                        Section { seriesCard(series, sessions: sessions) }
                    case let .single(session, _):
                        Section { singleRow(session) }
                    }
                }
            }
            .listStyle(.insetGrouped)
        }
    }

    /// Corrects the initial guess once real data arrives: `defaultWeekday`
    /// picks today, which may be a weekday this programme doesn't run.
    private func correctInitialWeekday() {
        guard !presentWeekdays.isEmpty, !presentWeekdays.contains(activeWeekday),
              let first = presentWeekdays.first else { return }
        activeWeekday = first
    }

    @ViewBuilder
    private func weekdayInfo(_ weekday: WeekdayProgramme) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(weekday.label).font(.headline)
            Text("Starts \(Fmt.timeOfDay(weekday.startTime)) · seated by \(Fmt.timeOfDay(weekday.seatedByTime))")
                .font(.subheadline)
            if let stewardId = weekday.partnerStewardMemberId {
                Text("Partner steward: \(directory.nameOf(stewardId))").font(.subheadline)
            }
            if let notes = weekday.notes, !notes.isEmpty {
                Text(notes).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func seriesCard(_ series: Series, sessions: [Session]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(series.name).font(.headline)
            HStack(spacing: 6) {
                badge(series.scoring.rawValue)
                badge(series.format.rawValue)
                if let bestOf = series.bestOf { badge("best \(bestOf.n) of \(bestOf.m)") }
                if !series.allowSubstitute { badge("no substitutes") }
            }
            if let note = series.eligibilityNote, !note.isEmpty {
                Text(note).font(.subheadline).foregroundStyle(.secondary)
            }
            if let note = series.generalNote, !note.isEmpty {
                Text(note).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)

        ForEach(sessions) { session in
            sessionLink(session, label: Fmt.date(session.date))
        }
    }

    @ViewBuilder
    private func singleRow(_ session: Session) -> some View {
        let isNoBridge = session.kind == .noBridge
        sessionLink(session, label: "\(Fmt.date(session.date)) — \(isNoBridge ? "No bridge" : session.title)")
    }

    @ViewBuilder
    private func sessionLink(_ session: Session, label: String) -> some View {
        let isPast = NZDate.isPast(session.date)
        Button {
            // The session's own year (plan §21 B3) — never the newest year.
            router.openSession(year: session.year, sessionId: session.id, from: .programme)
        } label: {
            HStack {
                Text(label).foregroundStyle(isPast || session.kind == .noBridge ? .secondary : .primary)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func badge(_ text: String) -> some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(Color.secondary.opacity(0.15), in: Capsule())
    }
}

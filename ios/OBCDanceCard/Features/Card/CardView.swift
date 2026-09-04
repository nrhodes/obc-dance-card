//
//  CardView.swift
//  My Dance Card — the Swift counterpart of `web/src/screens/HomeScreen.tsx`.
//
//  Reads the shared `MyEntriesStore` (plan §21 B2/B4 — one live `entries`
//  listener shared with the Calendar), then splits that list into "upcoming"
//  (grouped by weekday → series, year-qualified per plan §21 B3) and a
//  collapsed "Past" client-side.
//

import FirebaseFirestore
import SwiftUI

/// The card only needs the teams its own entries point at — not the
/// club-wide `TeamsStore` — because a past entry may belong to a team that
/// has since disbanded and dropped out of that store's query.
@MainActor
final class CardTeamsModel: ObservableObject {
    @Published private(set) var teams: [Team] = []

    /// Firestore caps an `in` query at 30 values; the card never spans more
    /// teams than a member could join in a season.
    private static let maxTeamIds = 10

    private var listener: ListenerRegistration?
    private var currentIds: [String] = []

    func refresh(entries: [Entry]) {
        let ids = Array(Set(entries.compactMap(\.teamId))).sorted().prefix(Self.maxTeamIds).map { $0 }
        guard ids != currentIds else { return }
        currentIds = ids
        listener?.remove()
        listener = nil
        guard !ids.isEmpty else { teams = []; return }
        listener = FirebaseService.db.collection(Paths.teams)
            .whereField(FieldPath.documentID(), in: ids)
            .addSnapshotListener { [weak self] snap, err in
                Task { @MainActor in
                    guard let self else { return }
                    self.teams = err == nil ? (snap?.documents.compactMap { try? $0.data(as: Team.self) } ?? []) : []
                }
            }
    }

    func stop() {
        listener?.remove()
        listener = nil
        currentIds = []
        teams = []
    }
}

struct CardView: View {
    @EnvironmentObject private var auth: AuthModel
    @EnvironmentObject private var programme: ProgrammeStore
    @EnvironmentObject private var myEntries: MyEntriesStore
    @EnvironmentObject private var router: Router
    @StateObject private var teamsModel = CardTeamsModel()

    @State private var pastOpen = false

    private static let pastLimit = 10

    private var today: String { NZDate.today() }

    private var upcoming: [CardWeekdayGroup] {
        CardLogic.groupEntries(
            entries: myEntries.entries.filter { $0.date >= today },
            sessions: programme.sessions,
            series: programme.series,
            weekdays: programme.weekdays,
            teams: teamsModel.teams
        )
    }

    private var past: [CardRow] {
        Array(CardLogic.pastRows(
            entries: myEntries.entries.filter { $0.date < today },
            sessions: programme.sessions,
            series: programme.series,
            teams: teamsModel.teams
        ).prefix(Self.pastLimit))
    }

    private var loading: Bool { programme.loading || myEntries.loading }

    var body: some View {
        List {
            if let error = myEntries.error {
                Section { Text(error.message).foregroundStyle(.secondary) }
            }

            if loading {
                Section { ProgressView("Loading…") }
            } else if upcoming.allSatisfy({ $0.groups.isEmpty }) {
                Section {
                    Text("Nothing on your card yet — open the Programme to sign up.")
                        .foregroundStyle(.secondary)
                }
            } else {
                ForEach(upcoming) { weekdayGroup in
                    Section(weekdayGroup.label) {
                        ForEach(weekdayGroup.groups) { group in
                            if !group.title.isEmpty {
                                Text(group.title)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(.secondary)
                            }
                            ForEach(group.rows) { row in
                                cardRow(row)
                            }
                        }
                    }
                }
            }

            Section {
                DisclosureGroup("Past sessions", isExpanded: $pastOpen) {
                    if past.isEmpty {
                        Text("No past sessions yet.").foregroundStyle(.secondary)
                    } else {
                        ForEach(past) { row in
                            cardRow(row, showTitle: true)
                        }
                    }
                }
            }
        }
        .navigationTitle(auth.member.map { "Hello, \($0.firstName)" } ?? "My card")
        .navigationBarTitleDisplayMode(.large)
        .onAppear { teamsModel.refresh(entries: myEntries.entries) }
        .onChange(of: myEntries.entries) { _, entries in teamsModel.refresh(entries: entries) }
    }

    @ViewBuilder
    private func cardRow(_ row: CardRow, showTitle: Bool = false) -> some View {
        Button {
            router.openSession(year: row.entry.year, sessionId: row.entry.sessionId, from: .card)
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(Fmt.date(row.date)).font(.body.weight(.medium))
                    if row.isTeam {
                        Text("Team")
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(Color.secondary.opacity(0.15), in: Capsule())
                    }
                }
                if showTitle {
                    Text(row.title).font(.subheadline).foregroundStyle(.secondary)
                }
                Text(row.statusText).font(.subheadline).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens this session")
    }
}

//
//  CardView.swift
//  My Dance Card — the Swift counterpart of `web/src/screens/HomeScreen.tsx`.
//
//  Subscribes once to every entry belonging to the signed-in member
//  (`entries where memberId == uid`, ordered by `date` — the existing
//  `entries(memberId, date)` composite index), then splits that one list into
//  "upcoming" (grouped by weekday → series, plan §5.4) and a collapsed "Past"
//  client-side. One subscription is plenty at club scale and reuses the same
//  index for both halves rather than running two range queries.
//

import FirebaseFirestore
import SwiftUI

@MainActor
final class CardModel: ObservableObject {
    @Published private(set) var entries: [Entry] = []
    @Published private(set) var teams: [Team] = []
    @Published private(set) var loaded = false
    @Published private(set) var error: SubscriptionError?

    /// Firestore caps an `in` query at 30 values; the card never legitimately
    /// spans more teams than a member could join in a season.
    private static let maxTeamIds = 10

    private var entriesListener: ListenerRegistration?
    private var teamsListener: ListenerRegistration?
    private var currentUid: String?
    private var currentTeamIds: [String] = []

    func start(uid: String?) {
        guard uid != currentUid else { return }
        stop()
        currentUid = uid
        guard let uid else {
            entries = []
            loaded = true
            return
        }
        loaded = false

        entriesListener = FirebaseService.db.collection(Paths.entries)
            .whereField("memberId", isEqualTo: uid)
            .order(by: "date")
            .addSnapshotListener { [weak self] snap, err in
                Task { @MainActor in
                    guard let self else { return }
                    if let err {
                        print("subscription_failed home_entries \((err as NSError).code)")
                        self.entries = []
                        self.error = SubscriptionError(code: "\((err as NSError).code)", resource: "your dance card")
                    } else {
                        self.entries = snap?.documents.compactMap { try? $0.data(as: Entry.self) } ?? []
                        self.error = nil
                        self.refreshTeams()
                    }
                    self.loaded = true
                }
            }
    }

    func stop() {
        entriesListener?.remove()
        entriesListener = nil
        teamsListener?.remove()
        teamsListener = nil
        currentUid = nil
        currentTeamIds = []
    }

    /// The card only needs the teams its own entries point at — not the
    /// club-wide `TeamsStore` — because a past entry may belong to a team
    /// that has since disbanded and dropped out of that store's query.
    private func refreshTeams() {
        let ids = Array(Set(entries.compactMap(\.teamId))).sorted().prefix(Self.maxTeamIds).map { $0 }
        guard ids != currentTeamIds else { return }
        currentTeamIds = ids
        teamsListener?.remove()
        teamsListener = nil
        guard !ids.isEmpty else {
            teams = []
            return
        }
        teamsListener = FirebaseService.db.collection(Paths.teams)
            .whereField(FieldPath.documentID(), in: ids)
            .addSnapshotListener { [weak self] snap, err in
                Task { @MainActor in
                    guard let self else { return }
                    self.teams = err == nil
                        ? (snap?.documents.compactMap { try? $0.data(as: Team.self) } ?? [])
                        : []
                }
            }
    }
}

struct CardView: View {
    @EnvironmentObject private var auth: AuthModel
    @EnvironmentObject private var programme: ProgrammeStore
    @EnvironmentObject private var router: Router
    @StateObject private var model = CardModel()

    @State private var pastOpen = false

    private static let pastLimit = 10

    private var today: String { NZDate.today() }

    private var upcoming: [CardWeekdayGroup] {
        CardLogic.groupEntries(
            entries: model.entries.filter { $0.date >= today },
            sessions: programme.sessions,
            series: programme.series,
            weekdays: programme.weekdays,
            teams: model.teams
        )
    }

    private var past: [CardRow] {
        Array(CardLogic.pastRows(
            entries: model.entries.filter { $0.date < today },
            sessions: programme.sessions,
            series: programme.series,
            teams: model.teams
        ).prefix(Self.pastLimit))
    }

    private var loading: Bool { programme.loading || !model.loaded }

    var body: some View {
        List {
            if let error = model.error {
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
        .onAppear { model.start(uid: auth.memberId) }
        .onChange(of: auth.memberId) { _, uid in model.start(uid: uid) }
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

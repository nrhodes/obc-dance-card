//
//  SessionView.swift
//  The session page — "who's playing" plus everything the signed-in member
//  can do about it. The Swift counterpart of
//  `web/src/screens/SessionScreen.tsx` (plan §5.6, §6, §9.2, §9.3, §12, §12A).
//
//  Which actions appear is decided entirely by `SessionActions.derive`, the
//  1:1 port of the web app's state machine — this file only renders its
//  result. Every mutation goes through a callable in `Api` (plan §3.3:
//  clients never write Firestore), and the client-side lock check is for
//  display only; the server re-checks it.
//

import FirebaseFirestore
import SwiftUI

@MainActor
final class SessionEntriesModel: ObservableObject {
    @Published private(set) var entries: [Entry] = []
    @Published private(set) var loaded = false
    @Published private(set) var error: SubscriptionError?

    private var listener: ListenerRegistration?
    private var currentSessionId: String?

    func start(sessionId: String) {
        guard sessionId != currentSessionId else { return }
        stop()
        currentSessionId = sessionId
        loaded = false

        listener = FirebaseService.db.collection(Paths.entries)
            .whereField("sessionId", isEqualTo: sessionId)
            .addSnapshotListener { [weak self] snap, err in
                Task { @MainActor in
                    guard let self else { return }
                    if let err {
                        print("subscription_failed session_entries \((err as NSError).code)")
                        self.entries = []
                        self.error = SubscriptionError(code: "\((err as NSError).code)", resource: "who's playing")
                    } else {
                        self.entries = snap?.documents.compactMap { try? $0.data(as: Entry.self) } ?? []
                        self.error = nil
                    }
                    self.loaded = true
                }
            }
    }

    func stop() {
        listener?.remove()
        listener = nil
        currentSessionId = nil
    }
}

struct SessionView: View {
    let year: Int
    let sessionId: String

    @EnvironmentObject private var auth: AuthModel
    @EnvironmentObject private var programme: ProgrammeStore
    @EnvironmentObject private var directory: MembersDirectoryStore
    @EnvironmentObject private var visitorsStore: VisitorsStore
    @EnvironmentObject private var teamsStore: TeamsStore
    @StateObject private var model = SessionEntriesModel()

    @State private var notice: String?
    @State private var actionError: String?
    @State private var sheet: SessionSheet?
    @State private var confirm: SessionConfirm?
    @State private var substituteCoverFor: CoverFor?

    private enum SessionSheet: Identifiable {
        case invitePartner(initialMemberId: String?)
        case solo(SoloStatus)
        case playWithVisitor
        case substituteCover
        case substitutePicker(CoverFor)

        var id: String {
            switch self {
            case let .invitePartner(id): return "invite:\(id ?? "")"
            case let .solo(status): return "solo:\(status.rawValue)"
            case .playWithVisitor: return "visitor"
            case .substituteCover: return "subCover"
            case let .substitutePicker(coverFor): return "subPicker:\(coverFor.rawValue)"
            }
        }
    }

    private struct SessionConfirm: Identifiable {
        var id = UUID()
        var title: String
        var message: String
        var confirmLabel: String
        var destructive: Bool
        var action: () async -> Void
    }

    // MARK: - Derived state

    private var session: Session? { programme.session(id: sessionId) }
    private var seriesDoc: Series? { programme.series(id: session?.seriesId) }
    private var weekdayDoc: WeekdayProgramme? { session.flatMap { programme.weekday($0.weekday) } }
    private var isTeamsSeries: Bool { seriesDoc?.format == .teams }
    private var selfId: String { auth.memberId ?? "" }

    private var ownEntry: Entry? {
        guard !selfId.isEmpty else { return nil }
        return model.entries.first { $0.memberId == selfId }
    }

    private var seriesTeams: [Team] {
        seriesDoc.map { teamsStore.teams(forSeries: $0.id) } ?? []
    }

    private var myTeam: Team? {
        seriesDoc.flatMap { teamsStore.myTeam(forSeries: $0.id) }
    }

    private var roster: SessionRosterView {
        Roster.build(entries: model.entries, nameOf: directory.nameOf)
    }

    private var actions: SessionActionsResult? {
        guard let session, let weekdayDoc else { return nil }
        let hasAbsence = myTeam.map {
            TeamLogic.sessionView(team: $0, sessionEntries: model.entries, sessionId: session.id).hasAbsence
        } ?? false
        return SessionActions.derive(
            ownEntry: ownEntry,
            session: session,
            weekday: weekdayDoc,
            roster: roster,
            context: SessionActionsContext(
                series: seriesDoc,
                team: myTeam,
                actorMemberId: auth.memberId,
                hasAbsence: hasAbsence
            )
        )
    }

    /// memberIds already confirmed on this session — excluded from the
    /// invite/substitute pickers.
    private var confirmedMemberIds: Set<String> {
        var ids = Set<String>()
        for pair in roster.pairs {
            ids.insert(pair.aMemberId)
            if let b = pair.bMemberId { ids.insert(b) }
        }
        return ids
    }

    // MARK: - Body

    var body: some View {
        Group {
            if programme.loading || !model.loaded || teamsStore.loading {
                ProgressView("Loading…")
            } else if let session {
                if session.kind == .noBridge {
                    noBridge(session)
                } else {
                    sessionBody(session)
                }
            } else {
                ContentUnavailableView(
                    "Session not found",
                    systemImage: "questionmark.circle",
                    description: Text("It may have been removed from the programme.")
                )
            }
        }
        .navigationTitle(session?.title ?? "Session")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { model.start(sessionId: sessionId) }
        .sheet(item: $sheet) { sheetContent($0) }
        .alert(item: $confirm) { item in
            Alert(
                title: Text(item.title),
                message: Text(item.message),
                primaryButton: item.destructive
                    ? .destructive(Text(item.confirmLabel)) { Task { await item.action() } }
                    : .default(Text(item.confirmLabel)) { Task { await item.action() } },
                secondaryButton: .cancel()
            )
        }
    }

    @ViewBuilder
    private func noBridge(_ session: Session) -> some View {
        VStack(spacing: 12) {
            Text(Fmt.date(session.date)).font(.title3.weight(.semibold))
            Text("No bridge on this date.")
            if !session.title.isEmpty {
                Text(session.title).foregroundStyle(.secondary)
            }
        }
        .padding()
    }

    @ViewBuilder
    private func sessionBody(_ session: Session) -> some View {
        List {
            headerSection(session)

            if let error = model.error {
                Section { Text(error.message).foregroundStyle(.secondary) }
            }

            if let ownEntry, let summary = Roster.describeOwnEntry(ownEntry, teams: seriesTeams) {
                Section { Text(summary).font(.body.weight(.medium)) }
            }

            if let notice {
                Section { Text(notice).foregroundStyle(.green) }
            }
            if let actionError {
                Section { Text(actionError).foregroundStyle(.red) }
            }

            whoIsPlayingSection

            if let actions {
                if case let .teamsFormat(_, _, role) = actions.state, let seriesDoc, let member = auth.member {
                    Section("Team") {
                        TeamPanelView(
                            year: year,
                            series: seriesDoc,
                            session: session,
                            role: role,
                            team: myTeam,
                            otherTeams: seriesTeams.filter { $0.id != myTeam?.id },
                            sessionEntries: model.entries,
                            member: member,
                            onNotice: { notice = $0; actionError = nil },
                            onSolo: { sheet = .solo($0) },
                            onChangeSolo: { status in Task { await changeSolo(to: status) } },
                            onRemoveSolo: { Task { await removeSolo() } }
                        )
                    }
                } else {
                    Section("Actions") { actionsPanel(actions.state) }
                }
            }
        }
    }

    @ViewBuilder
    private func headerSection(_ session: Session) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text("\(weekdayDoc?.label ?? session.weekday.rawValue.capitalized) · \(Fmt.date(session.date))")
                    .font(.subheadline)
                if let weekdayDoc {
                    Text("Starts \(Fmt.timeOfDay(weekdayDoc.startTime)) · seated by \(Fmt.timeOfDay(weekdayDoc.seatedByTime))")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                HStack(spacing: 6) {
                    if let scoring = session.scoring { badge(scoring.rawValue) }
                    if let format = session.format { badge(format.rawValue) }
                }
                if let notes = weekdayDoc?.notes, !notes.isEmpty {
                    Text(notes).font(.subheadline).foregroundStyle(.secondary)
                }
                if let note = seriesDoc?.eligibilityNote, !note.isEmpty {
                    Text(note).font(.subheadline).foregroundStyle(.secondary)
                }
                if let note = seriesDoc?.generalNote, !note.isEmpty {
                    Text(note).font(.subheadline).foregroundStyle(.secondary)
                }
                if actions?.state == .locked {
                    Text("This session has started or finished.")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.red)
                }
            }
            .padding(.vertical, 2)
        }
    }

    @ViewBuilder
    private var whoIsPlayingSection: some View {
        let labels = Roster.noticeboardLabels(format: seriesDoc?.format)
        let nobody = roster.isEmpty && seriesTeams.isEmpty

        Section("Who's playing") {
            if nobody {
                Text("Nobody has signed up yet.").foregroundStyle(.secondary)
            }

            if !isTeamsSeries {
                ForEach(roster.pairs) { pair in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(pair.aName) & \(pair.bName)\(pair.isVisitor ? " (visitor)" : "")")
                        if let sub = pair.substitute {
                            Text("sub: \(sub.name) for \(sub.coveredName)")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                }
            } else {
                ForEach(seriesTeams) { team in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(team.name).font(.headline)
                        Text("Captain: \(directory.nameOf(team.captainMemberId)) · \(team.status.rawValue)")
                            .font(.subheadline).foregroundStyle(.secondary)
                        ForEach(team.members) { entry in
                            Text("• \(entry.ref.displayName)"
                                 + (entry.ref.kind == .visitor ? " (visitor)" : "")
                                 + (entry.ref.memberId == team.captainMemberId ? " (captain)" : ""))
                                .font(.subheadline)
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }

        if !roster.lookingForPartner.isEmpty {
            Section(labels.lfp) {
                ForEach(roster.lookingForPartner) { row in
                    noticeboardRow(row, actionLabel: claimLabel(for: row)) { claim(row) }
                }
            }
        }
        if !roster.available.isEmpty {
            Section(labels.available) {
                ForEach(roster.available) { row in
                    noticeboardRow(row, actionLabel: inviteLabel(for: row)) { inviteFromNoticeboard(row) }
                }
            }
        }
    }

    @ViewBuilder
    private func noticeboardRow(_ row: SoloRow, actionLabel: String?, action: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(row.name)
            if let note = row.note, !note.isEmpty {
                Text(note).font(.subheadline).foregroundStyle(.secondary)
            }
            if let actionLabel {
                Button(actionLabel, action: action)
                    .buttonStyle(.bordered)
                    .controlSize(.regular)
            }
        }
        .padding(.vertical, 2)
    }

    private func claimLabel(for row: SoloRow) -> String? {
        guard let actions, actions.claimableMemberIds.contains(row.memberId) else { return nil }
        return isTeamsSeries ? "Add \(row.name) to my team" : "Play with \(row.name)"
    }

    private func inviteLabel(for row: SoloRow) -> String? {
        guard let actions, actions.inviteableMemberIds.contains(row.memberId) else { return nil }
        return "Invite \(row.name)"
    }

    // MARK: - Actions panel

    @ViewBuilder
    private func actionsPanel(_ state: OwnEntryActionState) -> some View {
        switch state {
        case .locked:
            Text("This session has started.")

        case .noEntryOpen:
            Button("Invite a partner") { sheet = .invitePartner(initialMemberId: nil) }
            Button("I'm looking for a partner") { sheet = .solo(.lookingForPartner) }
            Button("I'm available") { sheet = .solo(.available) }
            Button("Play with a visitor") { sheet = .playWithVisitor }

        case let .solo(status, _):
            let other: SoloStatus = status == .lookingForPartner ? .available : .lookingForPartner
            Button(other == .available ? "Switch to available" : "Switch to looking for a partner") {
                Task { await changeSolo(to: other) }
            }
            Button("Remove", role: .destructive) { Task { await removeSolo() } }

        case let .confirmed(partner, _, substituteOption):
            if case let .arranged(sub) = substituteOption {
                Text("\(sub.displayName) is standing in for \(partner.displayName) this week.")
            }
            if substituteOption == .visitorPairing {
                Text("To change a visitor partner, cancel and sign up again.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            if substituteOption == .notAllowed {
                Text("This series does not allow substitutes.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            Button("Cancel this session", role: .destructive) { confirmCancelEntry() }
            if substituteOption == .available {
                Button("Arrange a substitute") { sheet = .substituteCover }
            }
            if case .arranged = substituteOption {
                Button("Remove substitute") { confirmRemoveSubstitute() }
            }

        case let .substituted(_, substitute):
            if let substitute {
                Text("\(substitute.displayName) is standing in for you this week.")
            }
            Button("Cancel this session", role: .destructive) { confirmCancelEntry() }
            Button("Remove substitute") { confirmRemoveSubstitute() }

        case let .sub(isSubstituteFor):
            Text("You're standing in this week for \(directory.nameOf(isSubstituteFor)).")
            Button("Cancel this stand-in", role: .destructive) { confirmCancelEntry() }

        case .noBridge, .teamsFormat:
            EmptyView()
        }
    }

    // MARK: - Sheets

    @ViewBuilder
    private func sheetContent(_ sheet: SessionSheet) -> some View {
        switch sheet {
        case let .invitePartner(initialMemberId):
            InvitePartnerSheet(
                members: directory.members,
                selfId: selfId,
                excludeMemberIds: confirmedMemberIds,
                seriesSessionCount: seriesDoc?.sessionIds.count,
                initialMember: initialMemberId.flatMap { directory.byId[$0] }
            ) { toMemberId, message, scope in
                await run("Invite sent.") {
                    try await Api.sendInvite(
                        scope: scope,
                        year: year,
                        sessionId: sessionId,
                        seriesId: session?.seriesId,
                        toMemberId: toMemberId,
                        message: message
                    )
                }
            }

        case let .solo(status):
            SoloStatusSheet(status: status, entityLabel: isTeamsSeries ? "team" : "partner") { note in
                await run(soloSetMessage(status)) {
                    try await Api.setSoloStatus(year: year, sessionId: sessionId, status: status, note: note)
                }
            }

        case .playWithVisitor:
            VisitorPickerSheet(
                title: "Play with a visitor",
                visitors: visitorsStore.visitors,
                seriesSessionCount: seriesDoc?.sessionIds.count,
                onSelect: { visitorId, wholeSeries in
                    await run("Signed up to play with your visitor.") {
                        try await Api.signUpWithVisitor(
                            scope: wholeSeries ? .series : .session,
                            year: year,
                            sessionId: sessionId,
                            seriesId: session?.seriesId,
                            visitorId: visitorId
                        )
                    }
                },
                onCreateVisitor: createVisitor
            )

        case .substituteCover:
            SubstituteCoverSheet(partnerName: ownEntry?.partner?.displayName ?? "your partner") { coverFor in
                self.sheet = .substitutePicker(coverFor)
            }

        case let .substitutePicker(coverFor):
            PartnerPickerSheet(
                title: "Who will stand in?",
                members: MemberPicker.filter(
                    directory.members,
                    selfId: selfId,
                    excludeMemberIds: confirmedMemberIds,
                    query: ""
                ),
                visitors: visitorsStore.visitors,
                onSelect: { ref in
                    guard let entryId = ownEntry?.id else { return ErrorMapper.genericMessage(AppError.generic) }
                    return await run("Substitute arranged.") {
                        try await Api.setSubstitute(entryId: entryId, substitute: ref, coverFor: coverFor)
                    }
                },
                onCreateVisitor: createVisitor
            )
        }
    }

    private func soloSetMessage(_ status: SoloStatus) -> String {
        if isTeamsSeries {
            return status == .lookingForPartner
                ? "You're now looking for a team."
                : "You're now available for a team."
        }
        return status == .lookingForPartner
            ? "You're now looking for a partner."
            : "You're now marked as available."
    }

    // MARK: - Action handlers

    private func claim(_ row: SoloRow) {
        confirm = SessionConfirm(
            title: isTeamsSeries ? "Add to your team?" : "Play with this partner?",
            message: isTeamsSeries
                ? "\(row.name) will join your team for every remaining session in this series."
                : "You'll be paired with \(row.name) for this session.",
            confirmLabel: isTeamsSeries ? "Add to my team" : "Play with them",
            destructive: false
        ) {
            do {
                let result = try await Api.claimLookingForPartner(
                    year: year, sessionId: sessionId, posterMemberId: row.memberId
                )
                actionError = nil
                if result.team != nil {
                    notice = "\(row.name) has joined your team."
                } else if result.repeatPartnerWarning == true {
                    notice = "You've already played with \(row.name) in this individual series."
                } else {
                    notice = "You're now playing with \(row.name)."
                }
            } catch {
                notice = nil
                actionError = ErrorMapper.action(error)
            }
        }
    }

    private func inviteFromNoticeboard(_ row: SoloRow) {
        if isTeamsSeries {
            guard let team = myTeam else { return }
            confirm = SessionConfirm(
                title: "Invite to your team?",
                message: "\(row.name) will be sent an invite to join your team.",
                confirmLabel: "Send invite",
                destructive: false
            ) {
                _ = await run("Invited \(row.name) to your team.") {
                    try await Api.inviteToTeam(teamId: team.id, toMemberId: row.memberId, message: nil)
                }
            }
        } else {
            sheet = .invitePartner(initialMemberId: row.memberId)
        }
    }

    private func confirmCancelEntry() {
        guard let entry = ownEntry else { return }
        confirm = SessionConfirm(
            title: "Cancel this session?",
            message: SessionActions.describeCancelConsequence(entry),
            confirmLabel: "Cancel this session",
            destructive: true
        ) {
            _ = await run("Your entry for this session has been cancelled.") {
                try await Api.cancelEntry(entryId: entry.id)
            }
        }
    }

    private func confirmRemoveSubstitute() {
        guard let entry = ownEntry else { return }
        confirm = SessionConfirm(
            title: "Remove this substitute?",
            message: "The original pairing will be restored for this session.",
            confirmLabel: "Remove substitute",
            destructive: true
        ) {
            _ = await run("Substitute removed.") {
                try await Api.clearSubstitute(entryId: entry.id)
            }
        }
    }

    /// Switching between the two solo statuses is a clear-then-set, because
    /// `setSoloStatus` won't overwrite an existing active entry.
    private func changeSolo(to newStatus: SoloStatus) async {
        let note = ownEntry?.note
        _ = await run(newStatus == .lookingForPartner
                      ? "You're now looking for a partner."
                      : "You're now marked as available.") {
            try await Api.clearSoloStatus(year: year, sessionId: sessionId)
            try await Api.setSoloStatus(year: year, sessionId: sessionId, status: newStatus, note: note)
        }
    }

    private func removeSolo() async {
        _ = await run("Removed from the noticeboard.") {
            try await Api.clearSoloStatus(year: year, sessionId: sessionId)
        }
    }

    private func createVisitor(_ values: VisitorFormValues) async -> Result<Visitor, AppError> {
        let v = values.normalised
        do {
            let result = try await Api.createVisitor(
                displayName: v.displayName,
                email: v.email,
                phone: v.phone,
                notes: v.notes,
                courtesyEmails: v.courtesyEmails
            )
            return .success(result.visitor)
        } catch {
            return .failure(AppError(code: ErrorMapper.toAppError(error).code,
                                     message: ErrorMapper.action(error)))
        }
    }

    /// Runs a callable, turning success into the shared notice banner and
    /// failure into display-safe copy. Returns the error message (so a sheet
    /// can show it inline) or nil.
    @discardableResult
    private func run(_ successMessage: String, _ body: () async throws -> Void) async -> String? {
        do {
            try await body()
            actionError = nil
            notice = successMessage
            return nil
        } catch {
            let message = ErrorMapper.action(error)
            notice = nil
            actionError = message
            return message
        }
    }

    private func badge(_ text: String) -> some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(Color.secondary.opacity(0.15), in: Capsule())
    }
}

//
//  TeamPanelView.swift
//  Team panel for a Teams-format series' session page (plan §12A) — the Swift
//  counterpart of `web/src/components/TeamPanel.tsx`. Renders one of three
//  views depending on the `TeamsRole` that `SessionActions.derive` worked out:
//
//   * `notOnTeam` — "Start a team", the noticeboard statuses ("Looking for a
//     team" / "Available for a team"), and a read-only list of the series'
//     other teams.
//   * `member`    — the roster, this session's absences/substitutes, and
//     "Leave team".
//   * `captain`   — the same, plus every captain action: invite a member, add
//     a visitor, remove someone, transfer captaincy, disband, and manage this
//     session's substitutes.
//
//  Every mutation goes through a teams callable (plan §3/§9.2). Successes are
//  reported up to the session page's one shared notice banner rather than
//  being announced twice.
//

import SwiftUI

struct TeamPanelView: View {
    let year: Int
    let series: Series
    let session: Session
    let role: TeamsRole
    let team: Team?
    let otherTeams: [Team]
    /// Entries for *this* session only — used to work out who's absent and
    /// who's standing in.
    let sessionEntries: [Entry]
    let member: Member

    let onNotice: (String) -> Void
    let onSolo: (SoloStatus) -> Void
    let onChangeSolo: (SoloStatus) -> Void
    let onRemoveSolo: () -> Void

    @EnvironmentObject private var directory: MembersDirectoryStore
    @EnvironmentObject private var visitorsStore: VisitorsStore

    @State private var sheet: PanelSheet?
    @State private var confirm: PanelConfirm?
    @State private var errorMessage: String?

    private enum PanelSheet: Identifiable {
        case start, invite, addVisitor, transferCaptaincy, addSessionSub

        var id: String { String(describing: self) }
    }

    private struct PanelConfirm: Identifiable {
        var id = UUID()
        var title: String
        var message: String
        var confirmLabel: String
        var action: () async -> Void
    }

    private var isCaptain: Bool {
        if case .captain = role { return true }
        return false
    }

    private var hasAbsence: Bool {
        if case let .captain(_, hasAbsence) = role { return hasAbsence }
        return false
    }

    var body: some View {
        Group {
            if let errorMessage {
                Text(errorMessage).foregroundStyle(.red)
            }
            switch role {
            case let .notOnTeam(solo):
                notOnTeamView(solo: solo)
            case .member, .captain:
                if let team { onTeamView(team) }
            }
        }
        .sheet(item: $sheet) { sheetContent($0) }
        .alert(item: $confirm) { item in
            Alert(
                title: Text(item.title),
                message: Text(item.message),
                primaryButton: .destructive(Text(item.confirmLabel)) { Task { await item.action() } },
                secondaryButton: .cancel()
            )
        }
    }

    // MARK: - Not on a team

    @ViewBuilder
    private func notOnTeamView(solo: TeamsRole.SoloListing?) -> some View {
        if let solo {
            Button(solo.status == .lookingForPartner
                   ? "Switch to available for a team"
                   : "Switch to looking for a team") {
                onChangeSolo(solo.status == .lookingForPartner ? .available : .lookingForPartner)
            }
            Button("Remove", role: .destructive, action: onRemoveSolo)
        } else {
            Button("Start a team") { sheet = .start }
            Button("I'm looking for a team") { onSolo(.lookingForPartner) }
            Button("I'm available for a team") { onSolo(.available) }
        }

        if !otherTeams.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("Other teams in this series").font(.subheadline.weight(.semibold))
                ForEach(otherTeams) { other in
                    Text("\(other.name) — captain \(directory.nameOf(other.captainMemberId)) · "
                         + "\(Fmt.pluralised(other.members.count, "member")) · \(other.status.rawValue)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 4)
        }
    }

    // MARK: - On a team

    @ViewBuilder
    private func onTeamView(_ team: Team) -> some View {
        let view = TeamLogic.sessionView(team: team, sessionEntries: sessionEntries, sessionId: session.id)

        VStack(alignment: .leading, spacing: 4) {
            Text(team.name).font(.headline)
            Text("\(TeamLogic.statusLabel(team: team, series: series)) · Captain: \(directory.nameOf(team.captainMemberId))")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)

        ForEach(team.members) { entry in
            rosterRow(entry.ref, team: team)
        }

        if !view.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("This session").font(.subheadline.weight(.semibold))
                if !view.absentMemberIds.isEmpty {
                    Text("Absent: " + view.absentMemberIds.map(directory.nameOf).joined(separator: ", "))
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                ForEach(view.memberSubstitutes) { sub in
                    substituteRow(
                        label: "Standing in: \(directory.nameOf(sub.memberId))",
                        ref: .member(memberId: sub.memberId),
                        name: directory.nameOf(sub.memberId),
                        team: team
                    )
                }
                ForEach(view.visitorSubstitutes) { ref in
                    substituteRow(
                        label: "Standing in: \(ref.displayName) (visitor)",
                        ref: PartnerRefInput(ref),
                        name: ref.displayName,
                        team: team
                    )
                }
            }
            .padding(.vertical, 4)
        }

        if isCaptain {
            Button("Invite a member") { sheet = .invite }
            Button("Add a visitor") { sheet = .addVisitor }
            Button("Add a substitute for this session") { sheet = .addSessionSub }
                .disabled(!hasAbsence)
            Button("Transfer captaincy") { sheet = .transferCaptaincy }
            Button("Disband team", role: .destructive) { confirmDisband(team) }
        } else {
            Button("Leave team", role: .destructive) { confirmLeave(team) }
            Text("Captains must transfer the captaincy or disband before leaving.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func rosterRow(_ ref: PartnerRef, team: Team) -> some View {
        let isCaptainRef = ref.memberId == team.captainMemberId
        HStack {
            Text(ref.displayName
                 + (ref.kind == .visitor ? " (visitor)" : "")
                 + (isCaptainRef ? " (captain)" : ""))
            Spacer()
            if isCaptain && !isCaptainRef {
                Button("Remove") { confirmRemove(ref, from: team) }
                    .buttonStyle(.borderless)
                    .foregroundStyle(.red)
            }
        }
    }

    @ViewBuilder
    private func substituteRow(label: String, ref: PartnerRefInput, name: String, team: Team) -> some View {
        HStack {
            Text(label).font(.subheadline)
            Spacer()
            if isCaptain {
                Button("Remove") { confirmRemoveSessionSub(ref, name: name, team: team) }
                    .buttonStyle(.borderless)
                    .foregroundStyle(.red)
            }
        }
    }

    // MARK: - Sheets

    @ViewBuilder
    private func sheetContent(_ sheet: PanelSheet) -> some View {
        switch sheet {
        case .start:
            StartTeamSheet { name in
                await run("Team started.") {
                    try await Api.createTeam(year: year, seriesId: series.id, name: name)
                }
            }

        case .invite:
            if let team {
                InviteToTeamSheet(
                    members: directory.members,
                    selfId: member.id,
                    excludeMemberIds: team.rosterMemberIds
                ) { toMemberId, message in
                    await run("Invite sent.") {
                        try await Api.inviteToTeam(teamId: team.id, toMemberId: toMemberId, message: message)
                    }
                }
            }

        case .addVisitor:
            if let team {
                VisitorPickerSheet(
                    title: "Add a visitor to the team",
                    visitors: visitorsStore.visitors,
                    seriesSessionCount: nil,
                    onSelect: { visitorId, _ in
                        await run("Visitor added to the team.") {
                            try await Api.addVisitorToTeam(teamId: team.id, visitorId: visitorId)
                        }
                    },
                    onCreateVisitor: createVisitor
                )
            }

        case .transferCaptaincy:
            if let team {
                TransferCaptaincySheet(
                    candidates: team.members.compactMap { entry in
                        guard let memberId = entry.ref.memberId, memberId != team.captainMemberId else { return nil }
                        return TransferCaptaincySheet.Candidate(memberId: memberId, name: entry.ref.displayName)
                    }
                ) { toMemberId in
                    await run("Captaincy offer sent.") {
                        try await Api.transferCaptaincy(teamId: team.id, toMemberId: toMemberId)
                    }
                }
            }

        case .addSessionSub:
            if let team {
                PartnerPickerSheet(
                    title: "Who will play this session?",
                    members: MemberPicker.filter(
                        directory.members,
                        selfId: "",
                        excludeMemberIds: team.rosterMemberIds,
                        query: ""
                    ),
                    visitors: visitorsStore.visitors,
                    onSelect: { ref in
                        await run("Substitute added for this session.") {
                            try await Api.addTeamSessionSubstitute(
                                teamId: team.id, sessionId: session.id, ref: ref
                            )
                        }
                    },
                    onCreateVisitor: createVisitor
                )
            }
        }
    }

    // MARK: - Confirmations

    private func confirmLeave(_ team: Team) {
        confirm = PanelConfirm(
            title: "Leave this team?",
            message: "You'll be removed from the team roster and your future sessions in this series will be cancelled.",
            confirmLabel: "Leave team"
        ) {
            await run("You've left the team.") { try await Api.leaveTeam(teamId: team.id) }
        }
    }

    private func confirmRemove(_ ref: PartnerRef, from team: Team) {
        let name = ref.displayName
        let isVisitor = ref.kind == .visitor
        confirm = PanelConfirm(
            title: isVisitor ? "Remove this visitor?" : "Remove this member?",
            message: isVisitor
                ? "\(name) will be removed from the team."
                : "\(name) will be removed from the team and their future sessions in this series will be cancelled.",
            confirmLabel: "Remove"
        ) {
            await run("\(name) was removed from the team.") {
                if let visitorId = ref.visitorId {
                    try await Api.removeVisitorFromTeam(teamId: team.id, visitorId: visitorId)
                } else {
                    try await Api.removeFromTeam(teamId: team.id, ref: PartnerRefInput(ref))
                }
            }
        }
    }

    private func confirmRemoveSessionSub(_ ref: PartnerRefInput, name: String, team: Team) {
        confirm = PanelConfirm(
            title: "Remove this substitute?",
            message: "\(name) will no longer be standing in for this session.",
            confirmLabel: "Remove"
        ) {
            await run("Substitute removed.") {
                try await Api.clearTeamSessionSubstitute(teamId: team.id, sessionId: session.id, ref: ref)
            }
        }
    }

    private func confirmDisband(_ team: Team) {
        confirm = PanelConfirm(
            title: "Disband this team?",
            message: "Every team member's future sessions in this series will be cancelled and the team will close. This cannot be undone.",
            confirmLabel: "Disband team"
        ) {
            await run("Team disbanded.") { try await Api.disbandTeam(teamId: team.id) }
        }
    }

    // MARK: - Plumbing

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

    @discardableResult
    private func run(_ successMessage: String, _ body: () async throws -> Void) async -> String? {
        do {
            try await body()
            errorMessage = nil
            onNotice(successMessage)
            return nil
        } catch {
            let message = ErrorMapper.action(error)
            errorMessage = message
            return message
        }
    }
}

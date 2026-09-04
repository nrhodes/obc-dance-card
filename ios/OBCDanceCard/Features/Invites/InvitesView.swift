//
//  InvitesView.swift
//  Invites inbox — the counterpart of `web/src/screens/InvitesScreen.tsx`.
//  Incoming pending invites (Accept/Decline), outgoing pending ones
//  (Withdraw), and the last ten resolved invites, read-only. Every mutation
//  goes through `respondToInvite` / `cancelInvite` (plan §3.3).
//

import SwiftUI

struct InvitesView: View {
    @EnvironmentObject private var invites: InvitesStore
    @EnvironmentObject private var directory: MembersDirectoryStore
    @EnvironmentObject private var programme: ProgrammeStore
    @EnvironmentObject private var teams: TeamsStore

    @State private var busyId: String?
    @State private var errorById: [String: String] = [:]
    @State private var notice: String?

    var body: some View {
        List {
            if let notice {
                Section { Text(notice).foregroundStyle(.green) }
            }
            if let error = invites.error {
                Section { Text(error.message).foregroundStyle(.secondary) }
            }

            Section("Incoming") {
                if invites.loading {
                    ProgressView()
                } else if invites.incoming.isEmpty {
                    Text("No invites waiting for you.").foregroundStyle(.secondary)
                }
                ForEach(invites.incoming) { invite in
                    incomingRow(invite)
                }
            }

            Section("Sent") {
                if !invites.loading && invites.outgoing.isEmpty {
                    Text("You have no pending invites out.").foregroundStyle(.secondary)
                }
                ForEach(invites.outgoing) { invite in
                    outgoingRow(invite)
                }
            }

            Section("Recently resolved") {
                if !invites.loading && invites.resolved.isEmpty {
                    Text("Nothing yet.").foregroundStyle(.secondary)
                }
                ForEach(invites.resolved) { invite in
                    Text("\(directory.nameOf(invite.fromMemberId)) & \(directory.nameOf(invite.toMemberId)) — "
                         + "\(scopeLabel(invite)) — \(invite.status.rawValue)")
                        .font(.subheadline)
                }
            }
        }
        .navigationTitle("Invites")
    }

    // MARK: - Rows

    @ViewBuilder
    private func incomingRow(_ invite: Invite) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(headline(invite)).font(.body.weight(.semibold))
            if invite.scope != .team {
                Text(scopeLabel(invite)).font(.subheadline).foregroundStyle(.secondary)
            }
            if !invite.sessionIds.isEmpty {
                Text(datesLabel(invite)).font(.subheadline).foregroundStyle(.secondary)
            }
            if let message = invite.message, !message.isEmpty {
                Text("“\(message)”").font(.subheadline)
            }
            Text("Expires \(Fmt.dateTime(invite.expiresAt))")
                .font(.footnote).foregroundStyle(.secondary)
            if let error = errorById[invite.id] {
                Text(error).foregroundStyle(.red).font(.subheadline)
            }
            HStack {
                Button("Accept") { Task { await respond(invite, accept: true) } }
                    .buttonStyle(.borderedProminent)
                Button("Decline") { Task { await respond(invite, accept: false) } }
                    .buttonStyle(.bordered)
            }
            .disabled(busyId == invite.id)
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func outgoingRow(_ invite: Invite) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Invited \(directory.nameOf(invite.toMemberId)) — \(scopeLabel(invite))")
            if !invite.sessionIds.isEmpty {
                Text(datesLabel(invite)).font(.subheadline).foregroundStyle(.secondary)
            }
            if let error = errorById[invite.id] {
                Text(error).foregroundStyle(.red).font(.subheadline)
            }
            Button("Withdraw") { Task { await withdraw(invite) } }
                .buttonStyle(.bordered)
                .disabled(busyId == invite.id)
        }
        .padding(.vertical, 4)
    }

    // MARK: - Labels (mirrors the web screen's helpers)

    private func scopeLabel(_ invite: Invite) -> String {
        switch invite.scope {
        case .team:
            let n = invite.sessionIds.count
            return n > 0 ? "whole series: \(Fmt.pluralised(n, "session"))" : "captaincy offer"
        case .series:
            return "whole series: \(Fmt.pluralised(invite.sessionIds.count, "session"))"
        case .session:
            return "single session"
        }
    }

    private func datesLabel(_ invite: Invite) -> String {
        invite.sessionIds
            .compactMap { sid in programme.sessions.first { $0.id == sid }?.date }
            .sorted()
            .map(Fmt.date)
            .joined(separator: ", ")
    }

    /// "Team invite from <captain> — <team name> (<series>)" /
    /// "<name> wants you to be captain of <team>" (plan §12A.3).
    private func headline(_ invite: Invite) -> String {
        let from = directory.nameOf(invite.fromMemberId)
        guard invite.scope == .team else { return "\(from) invited you" }
        let teamName = invite.teamId.flatMap { teams.team(id: $0)?.name } ?? "a team"
        if invite.kind == .captaincy {
            return "\(from) wants you to be captain of \(teamName)"
        }
        // Year from the invite's own first session (plan §21 B3): `seriesId`
        // repeats across years, so a bare id lookup could name the wrong year's series.
        let year = invite.sessionIds.first.flatMap { programme.session(id: $0)?.year }
        let seriesName = invite.seriesId.flatMap { id in
            programme.series.first { $0.id == id && (year == nil || $0.year == year) }?.name
        }
        return "Team invite from \(from) — \(teamName)" + (seriesName.map { " (\($0))" } ?? "")
    }

    // MARK: - Actions

    private func respond(_ invite: Invite, accept: Bool) async {
        busyId = invite.id
        errorById[invite.id] = nil
        notice = nil
        do {
            let result = try await Api.respondToInvite(inviteId: invite.id, accept: accept)
            if result.repeatPartnerWarning == true {
                notice = "You've already played with \(directory.nameOf(invite.fromMemberId)) in this individual series."
            }
        } catch {
            errorById[invite.id] = ErrorMapper.action(error)
        }
        busyId = nil
    }

    private func withdraw(_ invite: Invite) async {
        busyId = invite.id
        errorById[invite.id] = nil
        notice = nil
        do {
            try await Api.cancelInvite(inviteId: invite.id)
        } catch {
            errorById[invite.id] = ErrorMapper.action(error)
        }
        busyId = nil
    }
}

//
//  TeamLogic.swift
//  Pure helpers for a Teams-format series' team panel — a 1:1 port of
//  `web/src/lib/team.ts` (plan §5.9, §7 I9, §12A). Kept out of the view so
//  the "who is absent this session, who is standing in" grouping is
//  unit-testable on its own.
//

import Foundation

struct TeamSessionView: Equatable {
    /// memberIds of rostered team members whose entry for this session is
    /// `cancelled` (an absence).
    var absentMemberIds: [String] = []
    /// `teamSessionOnly` member entries standing in for this session.
    var memberSubstitutes: [Entry] = []
    /// Visitor session-only substitutes (`team.sessionVisitors[sessionId]`).
    var visitorSubstitutes: [PartnerRef] = []
    /// True when some rostered member is absent this session — the captain's
    /// "add a substitute" gate (plan §9.2 precondition).
    var hasAbsence: Bool = false

    var isEmpty: Bool {
        absentMemberIds.isEmpty && memberSubstitutes.isEmpty && visitorSubstitutes.isEmpty
    }
}

enum TeamLogic {
    /// `"Forming (3 of 4–6)"` / `"Active (5 of 4–6)"`. Never called on a
    /// disbanded team. Mirrors `teamStatusLabel`.
    static func statusLabel(team: Team, series: Series) -> String {
        let label = team.status == .active ? "Active" : "Forming"
        return "\(label) (\(team.members.count) of \(series.teamMin)–\(series.teamMax))"
    }

    static func isFull(team: Team, series: Series) -> Bool {
        team.members.count >= series.teamMax
    }

    /// Builds the per-session absence/substitute view for `team` from every
    /// entry tagged with `team.id` for `sessionId` (the caller already has
    /// these — the session page subscribes to `entries where sessionId == X`).
    /// Mirrors `buildTeamSessionView`.
    static func sessionView(team: Team, sessionEntries: [Entry], sessionId: String) -> TeamSessionView {
        let rosterMemberIds = team.rosterMemberIds
        let teamEntries = sessionEntries.filter { $0.teamId == team.id && $0.sessionId == sessionId }

        let absentMemberIds = teamEntries
            .filter { !$0.teamSessionOnly && $0.status == .cancelled && rosterMemberIds.contains($0.memberId) }
            .map(\.memberId)

        let memberSubstitutes = teamEntries.filter { $0.teamSessionOnly && $0.status != .cancelled }
        let visitorSubstitutes = team.sessionVisitors?[sessionId] ?? []

        return TeamSessionView(
            absentMemberIds: absentMemberIds,
            memberSubstitutes: memberSubstitutes,
            visitorSubstitutes: visitorSubstitutes,
            hasAbsence: !absentMemberIds.isEmpty
        )
    }
}

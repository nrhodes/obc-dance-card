//
//  SessionActions.swift
//  Pure session-page action state machine — a 1:1 port of
//  `web/src/lib/sessionActions.ts` (plan §5.6, §6, §9.2, §9.3, §12, §12A).
//  Derives "what can the signed-in member do on this session page" from their
//  own entry (if any), the session/weekday/series, their team (if any) and the
//  roster, without touching SwiftUI or Firestore — so every branch is
//  unit-testable.
//
//  Precedence (plan §6/§9.2 `assertSessionOpen`, mirrored client-side for
//  *display only* — the server re-checks everything): a `noBridge` session
//  never has actions; a locked session never has actions regardless of
//  format; a Teams-format session always shows the Teams branch regardless of
//  the member's own entry; otherwise the member's own entry (or lack of one)
//  decides the state.
//

import Foundation

/// Whether/how a substitute may be arranged for a `confirmed` member–member
/// pairing (plan §12.7/§12.8).
enum SubstituteOption: Equatable {
    /// The partner is a visitor; substitution isn't modelled for visitor
    /// pairings (§12.8) — cancel and re-pair instead.
    case visitorPairing
    /// `series.allowSubstitute` is false, or the series is unknown.
    case notAllowed
    /// The *remaining* partner's view once a sub is in place.
    case arranged(substitute: PartnerRef)
    /// Free to arrange one.
    case available
}

/// The signed-in member's relationship to a Teams-format series (plan §12A).
enum TeamsRole: Equatable {
    case notOnTeam(solo: SoloListing?)
    case member
    case captain(full: Bool, hasAbsence: Bool)

    struct SoloListing: Equatable {
        var status: SoloStatus
        var note: String?
    }
}

enum OwnEntryActionState: Equatable {
    case noBridge
    case locked
    case teamsFormat(hasOwnEntry: Bool, teamId: String?, role: TeamsRole)
    case noEntryOpen
    case solo(status: SoloStatus, note: String?)
    case confirmed(partner: PartnerRef, partnerSubstitute: PartnerRef?, substituteOption: SubstituteOption)
    case substituted(partner: PartnerRef?, substitute: PartnerRef?)
    case sub(isSubstituteFor: String)
}

struct SessionActionsResult: Equatable {
    var state: OwnEntryActionState
    /// True when the member is free to claim/be invited into a roster row, or
    /// (Teams) is a captain with space to claim/invite.
    var canActOnRoster: Bool = false
    /// `looking_for_partner` rows the member may claim ("Play with X" /
    /// Teams: "Add X to my team").
    var claimableMemberIds: [String] = []
    /// `available` rows the member may invite ("Invite X").
    var inviteableMemberIds: [String] = []
}

/// Extra context the substitute/Teams branches need.
struct SessionActionsContext {
    /// The session's series, when known — for `allowSubstitute` and `teamMax`.
    var series: Series?
    /// The signed-in member's team in this series, if any (Teams only).
    var team: Team?
    /// The signed-in member's own id — tells captain from member, and
    /// excludes self from noticeboard rows.
    var actorMemberId: String?
    /// Teams only: whether some rostered team member's entry for *this*
    /// session is `cancelled` (the captain's "add a substitute" gate).
    var hasAbsence: Bool = false

    init(series: Series? = nil, team: Team? = nil, actorMemberId: String? = nil, hasAbsence: Bool = false) {
        self.series = series
        self.team = team
        self.actorMemberId = actorMemberId
        self.hasAbsence = hasAbsence
    }
}

enum SessionActions {

    /// True while an entry occupies no slot — never existed, or was cancelled.
    /// Mirrors `isFree` (and the server's `entries/lib.ts#isFree`).
    private static func isFree(_ entry: Entry?) -> Bool {
        guard let entry else { return true }
        return entry.status == .cancelled
    }

    private static func deriveTeamsRole(_ ownEntry: Entry?, _ ctx: SessionActionsContext) -> TeamsRole {
        if let team = ctx.team {
            let isCaptain = ctx.actorMemberId != nil && team.captainMemberId == ctx.actorMemberId
            if isCaptain {
                let teamMax = ctx.series?.teamMax ?? Int.max
                return .captain(full: team.members.count >= teamMax, hasAbsence: ctx.hasAbsence)
            }
            return .member
        }
        if let entry = ownEntry,
           entry.status == .lookingForPartner || entry.status == .available {
            let status: SoloStatus = entry.status == .lookingForPartner ? .lookingForPartner : .available
            return .notOnTeam(solo: TeamsRole.SoloListing(status: status, note: entry.note))
        }
        return .notOnTeam(solo: nil)
    }

    private static func computeSubstituteOption(_ entry: Entry, _ series: Series?) -> SubstituteOption {
        if entry.partner?.kind == .visitor { return .visitorPairing }
        if let sub = entry.partnerSubstitute { return .arranged(substitute: sub) }
        guard let series, series.allowSubstitute else { return .notAllowed }
        return .available
    }

    static func derive(
        ownEntry: Entry?,
        session: Session,
        weekday: WeekdayProgramme,
        roster: SessionRosterView,
        now: Date = Date(),
        context: SessionActionsContext = SessionActionsContext()
    ) -> SessionActionsResult {

        if session.kind == .noBridge {
            return SessionActionsResult(state: .noBridge)
        }

        let cutoff = NZDate.sessionCutoff(date: session.date, startTime: weekday.startTime)
        if now >= cutoff {
            return SessionActionsResult(state: .locked)
        }

        if session.format == .teams {
            let role = deriveTeamsRole(ownEntry, context)
            var canClaim = false
            if case let .captain(full, _) = role { canClaim = !full }
            let selfId = context.actorMemberId ?? ownEntry?.memberId
            return SessionActionsResult(
                state: .teamsFormat(
                    hasOwnEntry: !isFree(ownEntry),
                    teamId: context.team?.id,
                    role: role
                ),
                canActOnRoster: canClaim,
                claimableMemberIds: canClaim
                    ? roster.lookingForPartner.filter { $0.memberId != selfId }.map(\.memberId)
                    : [],
                inviteableMemberIds: canClaim
                    ? roster.available.filter { $0.memberId != selfId }.map(\.memberId)
                    : []
            )
        }

        if isFree(ownEntry) {
            let selfId = ownEntry?.memberId ?? context.actorMemberId
            return SessionActionsResult(
                state: .noEntryOpen,
                canActOnRoster: true,
                claimableMemberIds: roster.lookingForPartner.filter { $0.memberId != selfId }.map(\.memberId),
                inviteableMemberIds: roster.available.filter { $0.memberId != selfId }.map(\.memberId)
            )
        }

        // `isFree` returned false, so there is an entry.
        guard let entry = ownEntry else { return SessionActionsResult(state: .noEntryOpen) }

        if entry.status == .lookingForPartner || entry.status == .available {
            let status: SoloStatus = entry.status == .lookingForPartner ? .lookingForPartner : .available
            return SessionActionsResult(state: .solo(status: status, note: entry.note))
        }

        if let coveredFor = entry.isSubstituteFor {
            return SessionActionsResult(state: .sub(isSubstituteFor: coveredFor))
        }

        if entry.status == .substituted {
            return SessionActionsResult(state: .substituted(partner: entry.partner, substitute: entry.substitute))
        }

        // entry.status == .confirmed
        guard let partner = entry.partner else {
            // A confirmed entry always has a partner (I1); if one somehow
            // doesn't, showing "no actions" beats crashing.
            return SessionActionsResult(state: .locked)
        }
        return SessionActionsResult(state: .confirmed(
            partner: partner,
            partnerSubstitute: entry.partnerSubstitute,
            substituteOption: computeSubstituteOption(entry, context.series)
        ))
    }

    /// Plain-English consequence of cancelling `entry`, for the confirm
    /// dialog (plan §9.3: "the UI must explain it before confirming"). One
    /// sentence per §9.3 branch, from the canceller's point of view.
    /// Mirrors `describeCancelConsequence`.
    static func describeCancelConsequence(_ entry: Entry) -> String {
        if entry.teamId != nil {
            return "The team captain will be told you can't play this session. Your team is unaffected."
        }
        if entry.isSubstituteFor != nil {
            return "This cancels your one-week stand-in arrangement. Both players will be told, and they may need to arrange another substitute."
        }
        if entry.status == .substituted, let sub = entry.substitute {
            let partnerName = entry.partner?.displayName ?? "your partner"
            return "\(sub.displayName) will become \(partnerName)'s partner for this session, and you will be removed from it."
        }
        if let partner = entry.partner, partner.kind == .visitor {
            return "\(partner.displayName) will no longer be listed as your partner for this session."
        }
        if let partner = entry.partner, partner.kind == .member {
            let subNote = entry.partnerSubstitute.map {
                " \($0.displayName)'s arrangement to stand in for \(partner.displayName) this session will also be cancelled."
            } ?? ""
            return "\(partner.displayName) will be told you've cancelled and will be shown as looking for a partner.\(subNote)"
        }
        return "This will remove your entry for this session."
    }
}

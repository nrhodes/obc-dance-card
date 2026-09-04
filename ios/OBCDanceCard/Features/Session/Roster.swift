//
//  Roster.swift
//  Pure roster-shaping for the session page's "who's playing" view — a 1:1
//  port of `web/src/lib/roster.ts` (plan §5.6, §7). No SwiftUI, no Firestore,
//  so the grouping/labelling — dedupe by `pairingId`, substitution and
//  visitor annotations, own-entry summary — is unit-testable on its own.
//
//  Member names for confirmed pairs come from `nameOf(memberId)` (the members
//  directory), *not* from the denormalised `PartnerRef.displayName` on the
//  other side's entry. Both are equivalent for a member partner, but using
//  the directory uniformly means every member-facing name in the roster comes
//  from one source. `displayName` is used only where there is no alternative:
//  a visitor partner, or a substitute (who may be a visitor).
//

import Foundation

struct PairRow: Identifiable, Hashable {
    var pairingId: String
    var aMemberId: String
    var aName: String
    /// nil when the partner is a visitor.
    var bMemberId: String?
    var bName: String
    var isVisitor: Bool
    /// Set when B is covered this session by a substitute.
    var substitute: SubstituteNote?

    var id: String { pairingId }

    struct SubstituteNote: Hashable {
        var name: String
        var coveredName: String
    }
}

struct SoloRow: Identifiable, Hashable {
    var memberId: String
    var name: String
    var note: String?

    var id: String { memberId }
}

struct SessionRosterView {
    var pairs: [PairRow] = []
    var lookingForPartner: [SoloRow] = []
    var available: [SoloRow] = []

    var isEmpty: Bool {
        pairs.isEmpty && lookingForPartner.isEmpty && available.isEmpty
    }
}

enum Roster {
    private static func isActiveNonTeamEntry(_ e: Entry) -> Bool {
        e.status != .cancelled && e.teamId == nil
    }

    /// Pairs (or visitor pairs) for a Pairs/Individual session, deduped by
    /// `pairingId`. Mirrors `buildPairsRoster`.
    static func buildPairs(entries: [Entry], nameOf: (String) -> String) -> [PairRow] {
        let primary = entries.filter {
            isActiveNonTeamEntry($0) && $0.isSubstituteFor == nil
                && ($0.status == .confirmed || $0.status == .substituted)
        }

        var byPairingId: [String: [Entry]] = [:]
        for e in primary {
            guard let pairingId = e.pairingId else { continue }
            byPairingId[pairingId, default: []].append(e)
        }

        var rows: [PairRow] = []
        for (pairingId, group) in byPairingId {
            if group.count == 1 {
                let entry = group[0]
                guard let partner = entry.partner else { continue }
                rows.append(PairRow(
                    pairingId: pairingId,
                    aMemberId: entry.memberId,
                    aName: nameOf(entry.memberId),
                    bMemberId: partner.memberId,
                    bName: partner.displayName,
                    isVisitor: partner.kind == .visitor,
                    substitute: nil
                ))
                continue
            }

            // Two member-member entries: whichever is `substituted` is
            // "covered" this week; the other ("remaining") carries
            // `partnerSubstitute` (I4).
            let covered = group.first { $0.status == .substituted }
            let remaining = group.first { $0.id != covered?.id } ?? group[0]
            if let covered, let sub = remaining.partnerSubstitute {
                rows.append(PairRow(
                    pairingId: pairingId,
                    aMemberId: remaining.memberId,
                    aName: nameOf(remaining.memberId),
                    bMemberId: covered.memberId,
                    bName: nameOf(covered.memberId),
                    isVisitor: false,
                    substitute: PairRow.SubstituteNote(
                        name: sub.displayName,
                        coveredName: nameOf(covered.memberId)
                    )
                ))
                continue
            }

            // Both confirmed, no substitute this week: stable order by memberId.
            let sorted = group.sorted { $0.memberId < $1.memberId }
            rows.append(PairRow(
                pairingId: pairingId,
                aMemberId: sorted[0].memberId,
                aName: nameOf(sorted[0].memberId),
                bMemberId: sorted[1].memberId,
                bName: nameOf(sorted[1].memberId),
                isVisitor: false,
                substitute: nil
            ))
        }

        return rows.sorted { $0.aName.localizedCaseInsensitiveCompare($1.aName) == .orderedAscending }
    }

    /// Solo noticeboard rows, excluding team entries. Mirrors `buildSoloRows`.
    static func buildSoloRows(
        entries: [Entry],
        status: EntryStatus,
        nameOf: (String) -> String
    ) -> [SoloRow] {
        entries
            .filter { isActiveNonTeamEntry($0) && $0.status == status }
            .map { SoloRow(memberId: $0.memberId, name: nameOf($0.memberId), note: $0.note) }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    static func build(entries: [Entry], nameOf: (String) -> String) -> SessionRosterView {
        SessionRosterView(
            pairs: buildPairs(entries: entries, nameOf: nameOf),
            lookingForPartner: buildSoloRows(entries: entries, status: .lookingForPartner, nameOf: nameOf),
            available: buildSoloRows(entries: entries, status: .available, nameOf: nameOf)
        )
    }

    /// Noticeboard section labels, which read differently for a Teams series
    /// (plan §12A.4). Mirrors `noticeboardLabels`.
    static func noticeboardLabels(format: SeriesFormat?) -> (lfp: String, available: String) {
        format == .teams
            ? (lfp: "Looking for a team", available: "Available for a team")
            : (lfp: "Looking for a partner", available: "Available")
    }

    /// One-line summary of the signed-in member's own entry, for the
    /// "You: …" banner. Mirrors `describeOwnEntry`.
    static func describeOwnEntry(_ entry: Entry, teams: [Team]) -> String? {
        if entry.status == .cancelled { return nil }
        if let teamId = entry.teamId {
            if let team = teams.first(where: { $0.id == teamId }) {
                return "You: on team \"\(team.name)\""
            }
            return "You: on a team for this series"
        }
        if entry.status == .confirmed, let partner = entry.partner {
            if let sub = entry.partnerSubstitute {
                return "You: confirmed with \(partner.displayName) (sub this week: \(sub.displayName))"
            }
            return "You: confirmed with \(partner.displayName)"
                + (partner.kind == .visitor ? " (visitor)" : "")
        }
        if entry.status == .substituted, let sub = entry.substitute {
            return "You: substituted this week by \(sub.displayName)"
        }
        if entry.status == .unavailable { return "You've marked yourself unavailable for this session." }
        if entry.status == .lookingForPartner { return "You're looking for a partner." }
        if entry.status == .available { return "You're marked as available." }
        return nil
    }
}

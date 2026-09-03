/**
 * Pure (no React, no Firestore) roster-shaping helpers for the session page's
 * "who's playing" view (plan Phase 2b task, §5.6, §7). Kept separate from the
 * screen component so the grouping/labelling logic — dedupe by `pairingId`,
 * substitution/visitor annotations, own-entry summary — is unit-testable
 * without mounting React or mocking Firestore.
 *
 * Member names for confirmed pairs come from `nameOf(memberId)` (the members
 * directory), *not* from the denormalised `PartnerRef.displayName` on the
 * other side's entry — both are equivalent for a member partner, but using
 * the directory uniformly means every member-facing name in the roster comes
 * from one source. `PartnerRef.displayName` is used only where there is no
 * other way to get the name: a visitor partner, or a substitute (who may be
 * a visitor).
 */
import type { Entry, NOTICEBOARD_STATUSES, PartnerRef, SeriesFormat, Team } from '@obc/shared';

export interface PairRow {
  pairingId: string;
  aMemberId: string;
  aName: string;
  /** null when the partner is a visitor. */
  bMemberId: string | null;
  bName: string;
  isVisitor: boolean;
  /** Set when B is covered this session by a substitute. */
  substitute?: { name: string; coveredName: string };
}

export interface SoloRow {
  memberId: string;
  name: string;
  note?: string;
}

export interface SessionRosterView {
  pairs: PairRow[];
  lookingForPartner: SoloRow[];
  available: SoloRow[];
}

function isActiveNonTeamEntry(e: Entry): boolean {
  return e.status !== 'cancelled' && e.teamId == null;
}

/** Builds the pairs (or visitor pairs) list for a Pairs/Individual session, deduped by `pairingId`. */
export function buildPairsRoster(entries: Entry[], nameOf: (memberId: string) => string): PairRow[] {
  const primary = entries.filter(
    (e) => isActiveNonTeamEntry(e) && e.isSubstituteFor == null && (e.status === 'confirmed' || e.status === 'substituted'),
  );
  const byPairingId = new Map<string, Entry[]>();
  for (const e of primary) {
    if (!e.pairingId) continue;
    const list = byPairingId.get(e.pairingId) ?? [];
    list.push(e);
    byPairingId.set(e.pairingId, list);
  }

  const rows: PairRow[] = [];
  for (const [pairingId, group] of byPairingId) {
    if (group.length === 1) {
      const entry = group[0]!;
      const partner = entry.partner;
      if (!partner) continue;
      rows.push({
        pairingId,
        aMemberId: entry.memberId,
        aName: nameOf(entry.memberId),
        bMemberId: partner.kind === 'member' ? partner.memberId : null,
        bName: partner.displayName,
        isVisitor: partner.kind === 'visitor',
      });
      continue;
    }

    // Two member-member entries: whichever is `substituted` is "covered" this
    // week; the other ("remaining") carries `partnerSubstitute` (I4).
    const covered = group.find((e) => e.status === 'substituted');
    const remaining = group.find((e) => e !== covered) ?? group[0]!;
    if (covered && remaining.partnerSubstitute) {
      rows.push({
        pairingId,
        aMemberId: remaining.memberId,
        aName: nameOf(remaining.memberId),
        bMemberId: covered.memberId,
        bName: nameOf(covered.memberId),
        isVisitor: false,
        substitute: { name: remaining.partnerSubstitute.displayName, coveredName: nameOf(covered.memberId) },
      });
      continue;
    }

    // Both confirmed, no substitute this week: stable order by memberId.
    const [first, second] = [...group].sort((x, y) => x.memberId.localeCompare(y.memberId));
    rows.push({
      pairingId,
      aMemberId: first!.memberId,
      aName: nameOf(first!.memberId),
      bMemberId: second!.memberId,
      bName: nameOf(second!.memberId),
      isVisitor: false,
    });
  }

  return rows.sort((a, b) => a.aName.localeCompare(b.aName));
}

/** Solo noticeboard rows (Looking for Partner / Available), excluding team entries. */
export function buildSoloRows(entries: Entry[], status: (typeof NOTICEBOARD_STATUSES)[number], nameOf: (memberId: string) => string): SoloRow[] {
  return entries
    .filter((e) => isActiveNonTeamEntry(e) && e.status === status)
    .map((e) => ({
      memberId: e.memberId,
      name: nameOf(e.memberId),
      ...(e.note !== undefined ? { note: e.note } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildSessionRoster(entries: Entry[], nameOf: (memberId: string) => string): SessionRosterView {
  return {
    pairs: buildPairsRoster(entries, nameOf),
    lookingForPartner: buildSoloRows(entries, 'looking_for_partner', nameOf),
    available: buildSoloRows(entries, 'available', nameOf),
  };
}

/** Labels for the noticeboard sections, which read differently for a Teams series (plan §12A.4). */
export function noticeboardLabels(format: SeriesFormat | undefined): { lfp: string; available: string } {
  if (format === 'Teams') {
    return { lfp: 'Looking for a team', available: 'Available for a team' };
  }
  return { lfp: 'Looking for a partner', available: 'Available' };
}

/** One-line summary of the signed-in member's own entry, for the "You: ..." banner. */
export function describeOwnEntry(entry: Entry, teams: Team[]): string | null {
  if (entry.status === 'cancelled') return null;
  if (entry.teamId) {
    const team = teams.find((t) => t.id === entry.teamId);
    return team ? `You: on team "${team.name}"` : 'You: on a team for this series';
  }
  if (entry.status === 'confirmed' && entry.partner) {
    if (entry.partnerSubstitute) {
      return `You: confirmed with ${entry.partner.displayName} (sub this week: ${entry.partnerSubstitute.displayName})`;
    }
    return `You: confirmed with ${entry.partner.displayName}${entry.partner.kind === 'visitor' ? ' (visitor)' : ''}`;
  }
  if (entry.status === 'substituted' && entry.substitute) {
    return `You: substituted this week by ${entry.substitute.displayName}`;
  }
  if (entry.status === 'looking_for_partner') return "You're looking for a partner.";
  if (entry.status === 'available') return "You're marked as available.";
  if (entry.status === 'unavailable') return "You've marked yourself unavailable for this session.";
  return null;
}

/** Display name for a team member ref — visitor refs already carry their displayName. */
export function teamMemberName(ref: PartnerRef): string {
  return ref.displayName;
}

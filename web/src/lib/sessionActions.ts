/**
 * Pure session-page action state machine (plan Phase 3b task, extended Phase
 * 4c for visitors/substitutes/teams; §5.6, §6, §9.2, §9.3, §12, §12A). Derives
 * "what can the signed-in member do on this session page" from their own
 * entry (if any), the session/weekday/series, their team (if any), and the
 * roster — without touching React or Firestore, so every branch is
 * unit-testable.
 *
 * Precedence (plan §6/§9.2 `assertSessionOpen`, mirrored client-side for
 * display only — the server re-checks everything): a `noBridge` session
 * never has actions; a locked session never has actions regardless of
 * format; a Teams-format session always shows the Teams branch regardless of
 * the member's own entry; otherwise the member's own entry (or lack of one)
 * decides the state.
 */
import { sessionCutoff, type Entry, type PartnerRef, type Series, type Session, type Team, type WeekdayProgramme } from '@obc/shared';
import type { SessionRosterView } from './roster';

/**
 * Whether/how a substitute may be arranged for a `confirmed` member–member
 * pairing (plan §12.7/§12.8):
 * - `visitorPairing`  — the partner is a visitor; substitution isn't modelled
 *                       for visitor pairings (§12.8) — cancel and re-pair instead.
 * - `notAllowed`      — `series.allowSubstitute` is false (or unknown — no series).
 * - `arranged`        — the *remaining* partner's view once a sub is in place
 *                       (`partnerSubstitute` set) — mirrors the `substituted` state's
 *                       `substitute` field from the *covered* partner's view.
 * - `available`       — free to arrange one.
 */
export type SubstituteOption =
  | { kind: 'visitorPairing' }
  | { kind: 'notAllowed' }
  | { kind: 'arranged'; substitute: PartnerRef }
  | { kind: 'available' };

/** The signed-in member's relationship to a Teams-format series (plan §12A). */
export type TeamsRole =
  | { kind: 'notOnTeam'; solo: { status: 'looking_for_partner' | 'available'; note?: string } | null }
  | { kind: 'member' }
  | { kind: 'captain'; full: boolean; hasAbsence: boolean };

export type OwnEntryActionState =
  | { kind: 'noBridge' }
  | { kind: 'locked' }
  | { kind: 'teamsFormat'; hasOwnEntry: boolean; teamId: string | null; role: TeamsRole }
  | { kind: 'noEntryOpen' }
  | { kind: 'solo'; status: 'looking_for_partner' | 'available'; note?: string }
  /** Plan §21 B2: a solo `unavailable` marker — "don't offer me this session". The only action is to clear it. */
  | { kind: 'unavailable' }
  | { kind: 'confirmed'; partner: PartnerRef; partnerSubstitute: PartnerRef | null; substituteOption: SubstituteOption }
  | { kind: 'substituted'; partner: PartnerRef | null; substitute: PartnerRef | null }
  | { kind: 'sub'; isSubstituteFor: string };

export interface SessionActionsResult {
  state: OwnEntryActionState;
  /** True when the member is free to claim/be invited into a roster row, or (Teams) is a captain with space to claim/invite. */
  canActOnRoster: boolean;
  /** `looking_for_partner` roster rows the member may claim ("Play with X" / Teams: "Add X to my team"). */
  claimableMemberIds: string[];
  /** `available` roster rows the member may invite ("Invite X"). */
  inviteableMemberIds: string[];
}

/** Extra, mostly-optional context `deriveSessionActions` uses for the substitute/Teams branches. */
export interface SessionActionsContext {
  /** The session's series, when known — used for `allowSubstitute` and `teamMax`. */
  series?: Series | null;
  /** The signed-in member's team in this series, if any (Teams series only). */
  team?: Team | null;
  /** The signed-in member's own id — needed to tell captain from member, and to exclude self from noticeboard rows. */
  actorMemberId?: string | null;
  /** Teams only: whether some rostered team member's entry for *this* session is `cancelled` (captain's "add a substitute" gate). */
  hasAbsence?: boolean;
}

/** True while an entry occupies no slot — never existed, or was cancelled (mirrors `entries/lib.ts#isFree`). */
function isFree(entry: Entry | null | undefined): boolean {
  return !entry || entry.status === 'cancelled';
}

function noAction(state: OwnEntryActionState): SessionActionsResult {
  return { state, canActOnRoster: false, claimableMemberIds: [], inviteableMemberIds: [] };
}

function deriveTeamsRole(ownEntry: Entry | null | undefined, ctx: SessionActionsContext): TeamsRole {
  const team = ctx.team ?? null;
  if (team) {
    const isCaptain = !!ctx.actorMemberId && team.captainMemberId === ctx.actorMemberId;
    if (isCaptain) {
      const teamMax = ctx.series?.teamMax ?? Number.POSITIVE_INFINITY;
      return { kind: 'captain', full: team.members.length >= teamMax, hasAbsence: !!ctx.hasAbsence };
    }
    return { kind: 'member' };
  }
  if (ownEntry && (ownEntry.status === 'looking_for_partner' || ownEntry.status === 'available')) {
    return {
      kind: 'notOnTeam',
      solo: ownEntry.note === undefined ? { status: ownEntry.status } : { status: ownEntry.status, note: ownEntry.note },
    };
  }
  return { kind: 'notOnTeam', solo: null };
}

function computeSubstituteOption(entry: Entry, series: Series | null | undefined): SubstituteOption {
  if (entry.partner?.kind === 'visitor') return { kind: 'visitorPairing' };
  if (entry.partnerSubstitute) return { kind: 'arranged', substitute: entry.partnerSubstitute };
  if (!series || !series.allowSubstitute) return { kind: 'notAllowed' };
  return { kind: 'available' };
}

export function deriveSessionActions(
  ownEntry: Entry | null | undefined,
  session: Session,
  weekday: WeekdayProgramme,
  roster: SessionRosterView,
  now: Date = new Date(),
  context: SessionActionsContext = {},
): SessionActionsResult {
  if (session.kind === 'noBridge') {
    return noAction({ kind: 'noBridge' });
  }

  const locked = now.getTime() >= sessionCutoff(session.date, weekday.startTime).getTime();
  if (locked) {
    return noAction({ kind: 'locked' });
  }

  if (session.format === 'Teams') {
    const role = deriveTeamsRole(ownEntry, context);
    const canClaim = role.kind === 'captain' && !role.full;
    const selfId = context.actorMemberId ?? ownEntry?.memberId;
    return {
      state: { kind: 'teamsFormat', hasOwnEntry: !isFree(ownEntry), teamId: context.team?.id ?? null, role },
      canActOnRoster: canClaim,
      claimableMemberIds: canClaim ? roster.lookingForPartner.filter((r) => r.memberId !== selfId).map((r) => r.memberId) : [],
      inviteableMemberIds: canClaim ? roster.available.filter((r) => r.memberId !== selfId).map((r) => r.memberId) : [],
    };
  }

  if (isFree(ownEntry)) {
    const selfId = ownEntry?.memberId;
    return {
      state: { kind: 'noEntryOpen' },
      canActOnRoster: true,
      claimableMemberIds: roster.lookingForPartner.filter((r) => r.memberId !== selfId).map((r) => r.memberId),
      inviteableMemberIds: roster.available.filter((r) => r.memberId !== selfId).map((r) => r.memberId),
    };
  }

  const entry = ownEntry!;

  if (entry.status === 'looking_for_partner' || entry.status === 'available') {
    return noAction(
      entry.note === undefined
        ? { kind: 'solo', status: entry.status }
        : { kind: 'solo', status: entry.status, note: entry.note },
    );
  }

  // A solo `unavailable` marker (plan §21 B2) — must not fall through to the
  // `confirmed` branch below, which would mis-render it as a real booking.
  if (entry.status === 'unavailable') {
    return noAction({ kind: 'unavailable' });
  }

  if (entry.isSubstituteFor) {
    return noAction({ kind: 'sub', isSubstituteFor: entry.isSubstituteFor });
  }

  if (entry.status === 'substituted') {
    return noAction({ kind: 'substituted', partner: entry.partner, substitute: entry.substitute });
  }

  // entry.status === 'confirmed'
  return noAction({
    kind: 'confirmed',
    partner: entry.partner!,
    partnerSubstitute: entry.partnerSubstitute,
    substituteOption: computeSubstituteOption(entry, context.series),
  });
}

/**
 * Plain-English consequence of cancelling `entry`, for the confirm dialog
 * (plan §9.3 "the UI must explain it before confirming"). One sentence per
 * §9.3 branch, from the canceller's point of view.
 */
export function describeCancelConsequence(entry: Entry): string {
  if (entry.teamId) {
    return "The team captain will be told you can't play this session. Your team is unaffected.";
  }
  if (entry.isSubstituteFor) {
    return 'This cancels your one-week stand-in arrangement. Both players will be told, and they may need to arrange another substitute.';
  }
  if (entry.status === 'substituted' && entry.substitute) {
    const subName = entry.substitute.displayName;
    const partnerName = entry.partner?.displayName ?? 'your partner';
    return `${subName} will become ${partnerName}'s partner for this session, and you will be removed from it.`;
  }
  if (entry.partner?.kind === 'visitor') {
    return `${entry.partner.displayName} will no longer be listed as your partner for this session.`;
  }
  if (entry.partner?.kind === 'member') {
    const partnerName = entry.partner.displayName;
    const subNote = entry.partnerSubstitute
      ? ` ${entry.partnerSubstitute.displayName}'s arrangement to stand in for ${partnerName} this session will also be cancelled.`
      : '';
    return `${partnerName} will be told you've cancelled and will be shown as looking for a partner.${subNote}`;
  }
  return 'This will remove your entry for this session.';
}

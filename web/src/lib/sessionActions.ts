/**
 * Pure session-page action state machine (plan Phase 3b task, §5.6, §6, §9.2,
 * §9.3). Derives "what can the signed-in member do on this session page"
 * from their own entry (if any), the session/weekday, and the roster —
 * without touching React or Firestore, so every branch is unit-testable.
 *
 * Precedence (plan §6/§9.2 `assertSessionOpen`, mirrored client-side for
 * display only — the server re-checks everything): a `noBridge` session
 * never has actions; a locked session never has actions regardless of
 * format; a Teams-format session always shows the teams placeholder
 * (join/start a team is Phase 4b) regardless of the member's own entry;
 * otherwise the member's own entry (or lack of one) decides the state.
 */
import { sessionCutoff, type Entry, type PartnerRef, type Session, type WeekdayProgramme } from '@obc/shared';
import type { SessionRosterView } from './roster';

export type OwnEntryActionState =
  | { kind: 'noBridge' }
  | { kind: 'locked' }
  | { kind: 'teamsFormat'; hasOwnEntry: boolean }
  | { kind: 'noEntryOpen' }
  | { kind: 'solo'; status: 'looking_for_partner' | 'available'; note?: string }
  | { kind: 'confirmed'; partner: PartnerRef; partnerSubstitute: PartnerRef | null }
  | { kind: 'substituted'; partner: PartnerRef | null; substitute: PartnerRef | null }
  | { kind: 'sub'; isSubstituteFor: string };

export interface SessionActionsResult {
  state: OwnEntryActionState;
  /** True only in `noEntryOpen` — the member is free to claim/be invited into a roster row. */
  canActOnRoster: boolean;
  /** `looking_for_partner` roster rows the member may claim ("Play with X"). */
  claimableMemberIds: string[];
  /** `available` roster rows the member may invite ("Invite X", pre-filling the dialog). */
  inviteableMemberIds: string[];
}

/** True while an entry occupies no slot — never existed, or was cancelled (mirrors `entries/lib.ts#isFree`). */
function isFree(entry: Entry | null | undefined): boolean {
  return !entry || entry.status === 'cancelled';
}

function noAction(state: OwnEntryActionState): SessionActionsResult {
  return { state, canActOnRoster: false, claimableMemberIds: [], inviteableMemberIds: [] };
}

export function deriveSessionActions(
  ownEntry: Entry | null | undefined,
  session: Session,
  weekday: WeekdayProgramme,
  roster: SessionRosterView,
  now: Date = new Date(),
): SessionActionsResult {
  if (session.kind === 'noBridge') {
    return noAction({ kind: 'noBridge' });
  }

  const locked = now.getTime() >= sessionCutoff(session.date, weekday.startTime).getTime();
  if (locked) {
    return noAction({ kind: 'locked' });
  }

  if (session.format === 'Teams') {
    return noAction({ kind: 'teamsFormat', hasOwnEntry: !isFree(ownEntry) });
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

  if (entry.isSubstituteFor) {
    return noAction({ kind: 'sub', isSubstituteFor: entry.isSubstituteFor });
  }

  if (entry.status === 'substituted') {
    return noAction({ kind: 'substituted', partner: entry.partner, substitute: entry.substitute });
  }

  // entry.status === 'confirmed'
  return noAction({ kind: 'confirmed', partner: entry.partner!, partnerSubstitute: entry.partnerSubstitute });
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


/**
 * Pure (no React, no Firestore) helpers for rendering a Teams-format series'
 * team panel (plan Phase 4c task, §5.9, §7 I9, §12A). Kept separate from the
 * `TeamPanel` component so the "who is absent this session, who is standing
 * in" grouping is unit-testable without mounting React or mocking Firestore
 * — mirrors `lib/roster.ts` / `lib/card.ts`'s split.
 */
import type { Entry, PartnerRef, Series, Team } from '@obc/shared';

/** `"Forming (3 of 4–6)"` / `"Active (5 of 4–6)"` — never called on a disbanded team. */
export function teamStatusLabel(team: Team, series: Series): string {
  const label = team.status === 'active' ? 'Active' : 'Forming';
  return `${label} (${team.members.length} of ${series.teamMin}–${series.teamMax})`;
}

export function isTeamFull(team: Team, series: Series): boolean {
  return team.members.length >= series.teamMax;
}

export interface TeamSessionView {
  /** memberIds of rostered team members whose entry for this session is `cancelled` (an absence). */
  absentMemberIds: string[];
  /** `teamSessionOnly` member entries standing in for this session. */
  memberSubstitutes: Entry[];
  /** Visitor session-only substitutes for this session (`team.sessionVisitors[sessionId]`). */
  visitorSubstitutes: PartnerRef[];
  /** True when some rostered member is absent this session (captain's "add a substitute" gate — plan §9.2 precondition). */
  hasAbsence: boolean;
}

/**
 * Builds the per-session absence/substitute view for `team` from every entry
 * tagged with `team.id` for `sessionId` (the caller already has these — the
 * session page subscribes to `entries where sessionId == X`).
 */
export function buildTeamSessionView(team: Team, sessionEntries: Entry[], sessionId: string): TeamSessionView {
  const rosterMemberIds = new Set(
    team.members.filter((m) => m.ref.kind === 'member').map((m) => (m.ref as Extract<PartnerRef, { kind: 'member' }>).memberId),
  );

  const teamEntriesThisSession = sessionEntries.filter((e) => e.teamId === team.id && e.sessionId === sessionId);

  const absentMemberIds = teamEntriesThisSession
    .filter((e) => !e.teamSessionOnly && e.status === 'cancelled' && rosterMemberIds.has(e.memberId))
    .map((e) => e.memberId);

  const memberSubstitutes = teamEntriesThisSession.filter((e) => e.teamSessionOnly && e.status !== 'cancelled');

  const visitorSubstitutes = team.sessionVisitors?.[sessionId] ?? [];

  return { absentMemberIds, memberSubstitutes, visitorSubstitutes, hasAbsence: absentMemberIds.length > 0 };
}

/** Display name for a team member/visitor ref — both already carry `displayName` denormalised. */
export function teamRefName(ref: PartnerRef): string {
  return ref.displayName;
}

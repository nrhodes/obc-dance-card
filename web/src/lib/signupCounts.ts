/**
 * Pure (no React, no Firestore) sign-up aggregation for the admin Programme
 * editor (plan §21 B5 "Admin: sign-up counts per event").
 *
 * DEVIATION from the plan's B5 sketch: the sketch proposed a
 * `getSignupCounts` callable so the client wouldn't have to "pull every
 * entry to the client". But `ProgrammeEditor` already subscribes to the
 * whole selected year's `entries` (a date-range query on the top-level
 * collection) to compute the bare non-cancelled count it feeds
 * `SessionEditDialog`'s `activeEntryCount` — so a callable would add a
 * round trip and a second source of truth for no benefit. This module is
 * pure client-side aggregation over that already-subscribed data; counts
 * update live as entries change, no new callable/rules/index needed. See
 * the §21 B5 status note in docs/implementation-plan.md.
 *
 * A `teamId`-bearing entry never carries a `pairingId` (plan §7,
 * `validateTeamGroup`), so `pairs` and `teams` never double-count the same
 * entry — every non-cancelled entry contributes to at most one of the two
 * distinct-id sets.
 */
import type { Entry, SeriesFormat } from '@obc/shared';

export interface SignupCounts {
  /** Distinct non-null pairingIds among this session's non-cancelled entries. */
  pairs: number;
  /** Distinct non-null teamIds among this session's non-cancelled entries. */
  teams: number;
  looking: number;
  available: number;
  unavailable: number;
  /** All non-cancelled entries for this session — same value `SessionEditDialog` calls `activeEntryCount`. */
  total: number;
}

const EMPTY_COUNTS: SignupCounts = { pairs: 0, teams: 0, looking: 0, available: 0, unavailable: 0, total: 0 };

/**
 * Aggregate one session's non-cancelled entries. `entries` may be any
 * superset (e.g. a whole year) — entries for other sessions are ignored.
 */
export function sessionSignupCounts(sessionId: string, entries: Entry[]): SignupCounts {
  const pairingIds = new Set<string>();
  const teamIds = new Set<string>();
  let looking = 0;
  let available = 0;
  let unavailable = 0;
  let total = 0;

  for (const e of entries) {
    if (e.sessionId !== sessionId) continue;
    if (e.status === 'cancelled') continue;
    total += 1;
    if (e.pairingId) pairingIds.add(e.pairingId);
    if (e.teamId) teamIds.add(e.teamId);
    if (e.status === 'looking_for_partner') looking += 1;
    else if (e.status === 'available') available += 1;
    else if (e.status === 'unavailable') unavailable += 1;
  }

  if (total === 0) return EMPTY_COUNTS;
  return { pairs: pairingIds.size, teams: teamIds.size, looking, available, unavailable, total };
}

function pluralize(word: string, n: number): string {
  return n === 1 ? word : `${word}s`;
}

/**
 * Short display string for one session's counts, e.g. "3 pairs · 2 looking",
 * "2 teams · 1 available", or "No sign-ups yet" when everything is zero.
 * Teams-format series/sessions lead with `teams`; everything else leads
 * with `pairs`. The lead segment is omitted when its count is zero (e.g. a
 * Pairs session with only solo sign-ups reads "2 looking", not "0 pairs · 2
 * looking").
 */
export function formatSignupSummary(counts: SignupCounts, format: SeriesFormat): string {
  const leadLabel = format === 'Teams' ? 'team' : 'pair';
  const leadValue = format === 'Teams' ? counts.teams : counts.pairs;

  const parts: string[] = [];
  if (leadValue > 0) parts.push(`${leadValue} ${pluralize(leadLabel, leadValue)}`);
  if (counts.looking > 0) parts.push(`${counts.looking} looking`);
  if (counts.available > 0) parts.push(`${counts.available} available`);
  if (counts.unavailable > 0) parts.push(`${counts.unavailable} unavailable`);

  if (parts.length === 0) return 'No sign-ups yet';
  return parts.join(' · ');
}

/**
 * Per-series roll-up for the series header, e.g. "pairs 2–5 across 4
 * sessions", or "3 pairs every session" when every session has the same
 * count. Teams-format series roll up `teams` instead. `null` for a series
 * with no sessions (nothing to render).
 */
export function seriesSignupRange(
  sessionIds: string[],
  countsBySessionId: Map<string, SignupCounts>,
  format: SeriesFormat,
): string | null {
  if (sessionIds.length === 0) return null;

  const label = format === 'Teams' ? 'team' : 'pair';
  const values = sessionIds.map((id) => {
    const counts = countsBySessionId.get(id);
    return format === 'Teams' ? (counts?.teams ?? 0) : (counts?.pairs ?? 0);
  });
  const min = Math.min(...values);
  const max = Math.max(...values);

  if (min === max) return `${min} ${pluralize(label, min)} every session`;
  return `${pluralize(label, max)} ${min}–${max} across ${sessionIds.length} sessions`;
}

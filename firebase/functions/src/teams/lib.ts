/**
 * Shared helpers for the Teams feature (plan §5.9, §7 I9, §9.2 team
 * callables, §12A). Every team mutation follows the same shape as the
 * pairing helpers in `entries/lib.ts`: read everything a transaction needs
 * up front, compute the new/updated documents in memory, write them, then
 * re-validate `validateTeamGroup` against the *in-memory* merged state
 * (never a fresh read after a write — Firestore transactions require every
 * `get()` to happen before any `set()`/`update()`/`delete()`).
 */
import { HttpsError } from 'firebase-functions/v2/https';
import type { Transaction } from 'firebase-admin/firestore';
import {
  paths,
  validateTeamGroup,
  type Entry,
  type Programme,
  type Series,
  type Session,
  type Team,
  type TeamStatus,
  type WeekdayProgramme,
} from '@obc/shared';
import { db } from '../lib/admin.js';
import { entryId, isSessionLocked } from '../entries/lib.js';
import { createNotification } from '../notifications/create.js';

/** The one place that builds a `teams/{id}` document id (plan §5.9). */
export function teamId(seriesId: string, captainMemberId: string): string {
  return `${seriesId}-${captainMemberId}`;
}

/** Reads a team inside `tx`, or throws `not-found`. */
export async function loadTeam(tx: Transaction, id: string): Promise<Team> {
  const snap = await tx.get(db.doc(paths.team(id)));
  const team = snap.data() as Team | undefined;
  if (!team) {
    throw new HttpsError('not-found', 'Team not found.');
  }
  return team;
}

/** Reads a team inside `tx`, or `null` if it does not exist (no throw). */
export async function loadTeamOptional(tx: Transaction, id: string): Promise<Team | null> {
  const snap = await tx.get(db.doc(paths.team(id)));
  return (snap.data() as Team | undefined) ?? null;
}

export interface LoadedSeries {
  series: Series;
  weekday: WeekdayProgramme;
  programme: Programme;
}

/** Reads a series plus its weekday programme and year programme inside `tx`. */
export async function loadSeries(tx: Transaction, year: number, seriesId: string): Promise<LoadedSeries> {
  const seriesSnap = await tx.get(db.doc(paths.seriesDoc(year, seriesId)));
  const series = seriesSnap.data() as Series | undefined;
  if (!series) {
    throw new HttpsError('not-found', 'Series not found.');
  }

  const programmeSnap = await tx.get(db.doc(paths.programme(year)));
  const programme = programmeSnap.data() as Programme | undefined;
  if (!programme) {
    throw new HttpsError('not-found', 'Programme not found.');
  }

  const weekdaySnap = await tx.get(db.doc(paths.weekday(year, series.weekday)));
  const weekday = weekdaySnap.data() as WeekdayProgramme | undefined;
  if (!weekday) {
    throw new HttpsError('not-found', 'Weekday programme not found.');
  }

  return { series, weekday, programme };
}

/** `failed-precondition` unless `series` is a Teams-format series. */
export function assertTeamsSeries(series: Series): void {
  if (series.format !== 'Teams') {
    throw new HttpsError('failed-precondition', 'This series is not a Teams series.');
  }
}

/** `permission-denied` unless `actorId` is `team`'s captain. */
export function assertCaptain(team: Team, actorId: string): void {
  if (team.captainMemberId !== actorId) {
    throw new HttpsError('permission-denied', 'Only the team captain can do this.');
  }
}

/** `failed-precondition` if the team has already been disbanded. */
export function assertNotDisbanded(team: Team): void {
  if (team.status === 'disbanded') {
    throw new HttpsError('failed-precondition', 'This team has been disbanded.');
  }
}

/** Every session doc for `series`, sorted by date. */
export async function seriesSessions(tx: Transaction, year: number, series: Series): Promise<Session[]> {
  const sessions: Session[] = [];
  for (const sessionId of series.sessionIds) {
    const snap = await tx.get(db.doc(paths.session(year, sessionId)));
    const session = snap.data() as Session | undefined;
    if (session) sessions.push(session);
  }
  return sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * The subset of `sessions` a member can still be signed up / withdrawn for:
 * the programme is published, the session actually runs (not `noBridge`),
 * and it has not locked yet (§6/I7) — unless `force` (admin override).
 */
export function unlockedSessions(
  sessions: Session[],
  weekday: WeekdayProgramme,
  programme: Programme,
  opts: { force?: boolean } = {},
): Session[] {
  if (programme.status !== 'published') return [];
  return sessions.filter((s) => s.kind !== 'noBridge' && (opts.force || !isSessionLocked(s, weekday)));
}

/**
 * The non-disbanded team (if any) `memberId` belongs to in `seriesId` — a
 * member may be in at most one (plan §12A.7). There is no query for "does
 * this array contain this ref", so this reads every `forming`/`active` team
 * in the series (bounded, club-scale — teams(seriesId,status) index) and
 * checks membership in code.
 */
export async function memberTeamInSeries(tx: Transaction, seriesId: string, memberId: string): Promise<Team | null> {
  const snap = await tx.get(
    db.collection(paths.teams()).where('seriesId', '==', seriesId).where('status', 'in', ['forming', 'active']),
  );
  for (const doc of snap.docs) {
    const team = doc.data() as Team;
    if (team.members.some((m) => m.ref.kind === 'member' && m.ref.memberId === memberId)) {
      return team;
    }
  }
  return null;
}

/** Every entry currently tagged with `teamId` (any session, any status) — the baseline `validateTeamGroup` input. */
export async function loadTeamEntries(tx: Transaction, id: string): Promise<Entry[]> {
  const snap = await tx.get(db.collection(paths.entries()).where('teamId', '==', id));
  return snap.docs.map((d) => d.data() as Entry);
}

/** Overlays `updates` onto `base` by entry id — the in-memory "state after this transaction's writes" used to re-validate I9. */
export function mergeEntries(base: Entry[], updates: Entry[]): Entry[] {
  const byId = new Map(base.map((e) => [e.id, e]));
  for (const u of updates) byId.set(u.id, u);
  return [...byId.values()];
}

/** `internal` if `validateTeamGroup` finds any I9 violation in the given (already-merged) state. */
export function assertTeamValid(team: Team, series: Series, entries: Entry[]): void {
  const issues = validateTeamGroup(team, series, entries);
  if (issues.length > 0) {
    throw new HttpsError('internal', `Team invariant violated: ${issues.join('; ')}`);
  }
}

/** `'forming'` below `series.teamMin`, else `'active'` — never touches an already-`disbanded` team (plan design notes). */
export function refreshTeamStatus(team: Team, series: Series): TeamStatus {
  if (team.status === 'disbanded') return 'disbanded';
  return team.members.length < series.teamMin ? 'forming' : 'active';
}

/**
 * Writes a `confirmed` team entry for `memberId` at every session in
 * `sessions` (plan §5.9's `writeTeamEntries`). `existingEntries` must
 * already hold every session's current entry for this member (read earlier
 * in the same transaction, before any writes) — reused both to detect a
 * conflicting non-cancelled entry and to preserve `createdAt` when reusing a
 * cancelled doc. Pure/synchronous: only calls `tx.set`, never `tx.get`, so
 * it is safe to call after other reads in the same transaction have
 * finished (and before any other writes start).
 */
export function writeTeamEntries(
  tx: Transaction,
  team: Team,
  sessions: Session[],
  existingEntries: ReadonlyMap<string, Entry | null>,
  memberId: string,
  createdBy: string,
  onBehalfBy?: string,
): Entry[] {
  const now = new Date().toISOString();
  const written: Entry[] = [];
  for (const session of sessions) {
    const existing = existingEntries.get(session.id) ?? null;
    if (existing && existing.status !== 'cancelled') {
      throw new HttpsError('failed-precondition', `Already committed on ${session.date}.`);
    }
    const doc: Entry = {
      id: entryId(session.id, memberId),
      sessionId: session.id,
      date: session.date,
      weekday: session.weekday,
      seriesId: session.seriesId,
      memberId,
      // The member joining a team must already be the same cohort as the
      // team (enforced by every caller's precondition before this is
      // called) — denormalising the *team's* cohort here, not a freshly
      // read member doc, keeps this function synchronous/pure (doc header).
      cohort: team.cohort,
      status: 'confirmed',
      partner: null,
      pairingId: null,
      teamId: team.id,
      teamSessionOnly: false,
      substitute: null,
      partnerSubstitute: null,
      isSubstituteFor: null,
      createdBy,
      onBehalfBy,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    tx.set(db.doc(paths.entry(doc.id)), doc);
    written.push(doc);
  }
  return written;
}

/**
 * Cancels `memberId`'s entry at every session in `sessions` that currently
 * has a non-cancelled entry for them (plan §5.9's `cancelTeamEntries`) —
 * `teamId` and every other field are left untouched (history, and so a
 * `teamSessionOnly` sub arranged against the same session stays valid).
 * Callers pass only *future, unlocked* sessions (`unlockedSessions`) — a
 * locked session's entry is immutable (I7) and must not be touched here.
 * Same read/write discipline as `writeTeamEntries`.
 */
export function cancelTeamEntries(
  tx: Transaction,
  memberId: string,
  sessions: Session[],
  existingEntries: ReadonlyMap<string, Entry | null>,
): Entry[] {
  const now = new Date().toISOString();
  const cancelled: Entry[] = [];
  for (const session of sessions) {
    const existing = existingEntries.get(session.id);
    if (!existing || existing.status === 'cancelled' || existing.memberId !== memberId) continue;
    const updated: Entry = { ...existing, status: 'cancelled', updatedAt: now };
    tx.set(db.doc(paths.entry(updated.id)), updated);
    cancelled.push(updated);
  }
  return cancelled;
}

/**
 * Phase 6 hook (not wired to any callable yet — `deactivateMember` /
 * `eraseMember` will call this): removes `memberId` from every
 * `forming`/`active` team they belong to, across every series. If they were
 * the captain, captaincy passes to the earliest-joined remaining member
 * (notified), or the team is disbanded if none remain. Every future,
 * unlocked entry of theirs on each affected team is cancelled. Notifications
 * are sent directly (there is no acting admin to attribute this to — it is
 * a system cascade, like the scheduled sweep). Tested directly against the
 * emulator (plan's "Deactivation hook" note).
 */
export async function removeMemberFromAllTeams(memberId: string): Promise<void> {
  const snap = await db.collection(paths.teams()).where('status', 'in', ['forming', 'active']).get();
  const affected = snap.docs
    .map((d) => d.data() as Team)
    .filter((t) => t.members.some((m) => m.ref.kind === 'member' && m.ref.memberId === memberId));

  for (const team of affected) {
    const result = await db.runTransaction(async (tx) => {
      const current = await loadTeamOptional(tx, team.id);
      if (!current || current.status === 'disbanded') return null;
      const wasCaptain = current.captainMemberId === memberId;
      const remainingMembers = current.members.filter((m) => !(m.ref.kind === 'member' && m.ref.memberId === memberId));

      const { series, weekday, programme } = await loadSeries(tx, current.year, current.seriesId);
      const sessions = await seriesSessions(tx, current.year, series);
      const openSessions = unlockedSessions(sessions, weekday, programme);
      const existingEntries = new Map<string, Entry | null>();
      for (const session of openSessions) {
        const entrySnap = await tx.get(db.doc(paths.entry(entryId(session.id, memberId))));
        existingEntries.set(session.id, (entrySnap.data() as Entry | undefined) ?? null);
      }
      const baseline = await loadTeamEntries(tx, current.id);

      const now = new Date().toISOString();
      let updatedTeam: Team;
      let newCaptainId: string | null = null;

      const remainingMemberRefs = remainingMembers.filter(
        (m): m is { ref: Extract<Team['members'][number]['ref'], { kind: 'member' }>; joinedAt: string } =>
          m.ref.kind === 'member',
      );

      if (wasCaptain && remainingMemberRefs.length === 0) {
        // I9/validateTeamGroup requires `captainMemberId` to remain in
        // `members` even once disbanded (mirrors `disbandTeam`, which never
        // touches `members` either) — so the departing captain's ref stays,
        // stale, as a historical record.
        updatedTeam = { ...current, status: 'disbanded', updatedAt: now };
      } else if (wasCaptain) {
        const next = [...remainingMemberRefs].sort((a, b) => (a.joinedAt < b.joinedAt ? -1 : 1))[0]!;
        const withNewCaptain: Team = {
          ...current,
          members: remainingMembers,
          captainMemberId: next.ref.memberId,
          updatedAt: now,
        };
        withNewCaptain.status = refreshTeamStatus(withNewCaptain, series);
        updatedTeam = withNewCaptain;
        newCaptainId = next.ref.memberId;
      } else {
        const withoutMember: Team = { ...current, members: remainingMembers, updatedAt: now };
        withoutMember.status = refreshTeamStatus(withoutMember, series);
        updatedTeam = withoutMember;
      }

      const cancelled = cancelTeamEntries(tx, memberId, openSessions, existingEntries);
      tx.set(db.doc(paths.team(current.id)), updatedTeam);
      assertTeamValid(updatedTeam, series, mergeEntries(baseline, cancelled));

      return { team: updatedTeam, newCaptainId };
    });

    if (result?.newCaptainId) {
      await createNotification(
        result.newCaptainId,
        'team_captaincy_transferred',
        'You are now the team captain',
        `You are now the captain of "${result.team.name}" after the previous captain left the club.`,
        { teamId: result.team.id },
      );
    }
  }
}

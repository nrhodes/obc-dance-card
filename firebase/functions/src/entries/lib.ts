/**
 * Shared helpers for the dance-card core (plan §5.6, §9.2 `sendInvite` /
 * `respondToInvite` / `cancelInvite` / `setSoloStatus` / `clearSoloStatus` /
 * `claimLookingForPartner` / `cancelEntry`). Every pairing mutation goes
 * through `writePair` and re-validates `validatePairingGroup` before commit
 * (plan §7, "law").
 */
import { randomUUID } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import type { Transaction } from 'firebase-admin/firestore';
import {
  paths,
  sessionCutoff,
  validatePairingGroup,
  type Entry,
  type Member,
  type PartnerRef,
  type Programme,
  type Series,
  type Session,
  type WeekdayProgramme,
} from '@obc/shared';
import { db } from '../lib/admin.js';
import type { Caller } from '../lib/context.js';

/** The one place that builds an `entries/{id}` document id (plan §5.6). */
export function entryId(sessionId: string, memberId: string): string {
  return `${sessionId}_${memberId}`;
}

/** True while `entry` occupies no slot — never existed, or was cancelled. */
export function isFree(entry: Entry | null | undefined): boolean {
  return !entry || entry.status === 'cancelled';
}

/** The `PartnerRef` a member presents to their partner's entry. */
export function memberRef(member: Member): PartnerRef {
  return { kind: 'member', memberId: member.id, displayName: `${member.firstName} ${member.lastName}` };
}

export interface LoadedSession {
  session: Session;
  weekday: WeekdayProgramme;
  series: Series | null;
  programme: Programme;
}

/**
 * Reads a session plus everything needed to judge whether it is open
 * (its weekday programme, its series if any, and the year's programme
 * status) — all inside the caller's transaction. Every mutation that reads
 * `input.year`/`input.sessionId` starts here.
 */
export async function loadSession(tx: Transaction, year: number, sessionId: string): Promise<LoadedSession> {
  const sessionSnap = await tx.get(db.doc(paths.session(year, sessionId)));
  const session = sessionSnap.data() as Session | undefined;
  if (!session) {
    throw new HttpsError('not-found', 'Session not found.');
  }

  const programmeSnap = await tx.get(db.doc(paths.programme(year)));
  const programme = programmeSnap.data() as Programme | undefined;
  if (!programme) {
    throw new HttpsError('not-found', 'Programme not found.');
  }

  const weekdaySnap = await tx.get(db.doc(paths.weekday(year, session.weekday)));
  const weekday = weekdaySnap.data() as WeekdayProgramme | undefined;
  if (!weekday) {
    throw new HttpsError('not-found', 'Weekday programme not found.');
  }

  let series: Series | null = null;
  if (session.seriesId) {
    const seriesSnap = await tx.get(db.doc(paths.seriesDoc(year, session.seriesId)));
    series = (seriesSnap.data() as Series | undefined) ?? null;
    if (!series) {
      throw new HttpsError('not-found', 'Series not found.');
    }
  }

  return { session, weekday, series, programme };
}

/**
 * Whether `now` is at or past a session's cutoff instant (plan §6 / I7).
 * Pure — takes the already-loaded session/weekday, no I/O.
 */
export function isSessionLocked(session: Session, weekday: WeekdayProgramme, now: number = Date.now()): boolean {
  return now >= sessionCutoff(session.date, weekday.startTime).getTime();
}

/**
 * Every precondition a member mutation must satisfy before touching a
 * session's entries (plan §9.2 design notes): the programme is published,
 * the session actually takes bridge (not `noBridge`), it takes a partner
 * (not a Teams session), and — unless `force` — it has not locked yet.
 * Pure — no I/O; callers pass in what `loadSession` already read.
 *
 * `allowTeamsSession`: `cancelEntry` also has to withdraw a Teams member's
 * single-session entry (§9.3's team branch), which necessarily lives on a
 * `partnerRequired: false` Teams session — the one case where the
 * "not a pairing action" rejection below must not apply. Every other caller
 * (sendInvite, respondToInvite, setSoloStatus, claimLookingForPartner) is a
 * genuine pairing/listing action and leaves this at its default `false`.
 */
export function assertSessionOpen(
  session: Session,
  weekday: WeekdayProgramme,
  programme: Programme,
  opts: { force?: boolean; allowTeamsSession?: boolean } = {},
): void {
  if (programme.status !== 'published') {
    throw new HttpsError('failed-precondition', 'This programme has not been published yet.');
  }
  if (session.kind === 'noBridge') {
    throw new HttpsError('failed-precondition', 'There is no bridge on this date.');
  }
  if (!session.partnerRequired && !opts.allowTeamsSession) {
    if (session.format === 'Teams') {
      throw new HttpsError('failed-precondition', 'This is a teams event — join a team instead.');
    }
    throw new HttpsError('failed-precondition', 'This session does not require a partner.');
  }
  if (isSessionLocked(session, weekday) && !opts.force) {
    throw new HttpsError('failed-precondition', 'This session is locked; it has already started.');
  }
}

/**
 * `force: true` is an admin-only override of a locked session's cutoff
 * (plan §6). Every mutation that accepts `force` must call this right after
 * resolving the caller, before entering its transaction.
 */
export function assertForceAllowed(caller: Caller, force: boolean | undefined): void {
  if (force && !caller.isAdmin) {
    throw new HttpsError('permission-denied', 'Only admins can override a locked session.');
  }
}

/** Reads a member's entry for one session, or `null` if it never existed. */
export async function readEntry(tx: Transaction, sessionId: string, memberId: string): Promise<Entry | null> {
  const snap = await tx.get(db.doc(paths.entry(entryId(sessionId, memberId))));
  return (snap.data() as Entry | undefined) ?? null;
}

export interface WritePairInput {
  session: Session;
  a: Member;
  b: Member;
  createdBy: string;
  onBehalfBy?: string;
}

export interface WritePairResult {
  entryA: Entry;
  entryB: Entry;
}

/**
 * Writes both mirrored `confirmed` entries of a member–member pairing for one
 * session, with a fresh `pairingId` (plan §5.6 / I2). Re-validates
 * `validatePairingGroup` before returning — belt and braces on top of every
 * precondition the caller already checked.
 */
export async function writePair(tx: Transaction, input: WritePairInput): Promise<WritePairResult> {
  const { session, a, b, createdBy, onBehalfBy } = input;
  const pairingId = randomUUID();
  const now = new Date().toISOString();

  const shared = {
    sessionId: session.id,
    date: session.date,
    weekday: session.weekday,
    seriesId: session.seriesId,
    status: 'confirmed' as const,
    pairingId,
    teamId: null,
    teamSessionOnly: false,
    substitute: null,
    partnerSubstitute: null,
    isSubstituteFor: null,
    createdBy,
    onBehalfBy,
    updatedAt: now,
  };

  const entryA: Entry = { ...shared, id: entryId(session.id, a.id), memberId: a.id, partner: memberRef(b), createdAt: now };
  const entryB: Entry = { ...shared, id: entryId(session.id, b.id), memberId: b.id, partner: memberRef(a), createdAt: now };

  const issues = validatePairingGroup([entryA, entryB]);
  if (issues.length > 0) {
    throw new HttpsError('internal', `Pairing invariant violated: ${issues.join('; ')}`);
  }

  tx.set(db.doc(paths.entry(entryA.id)), entryA);
  tx.set(db.doc(paths.entry(entryB.id)), entryB);

  return { entryA, entryB };
}

/**
 * Plan §2 "Individual series" / §5.7's client-facing warning: true when `a`
 * and `b` already have a non-cancelled pairing on some *other* session of an
 * `Individual`-format series. Never blocks — the caller just surfaces it.
 * All reads happen inside `tx`, so call this before any writes in the same
 * transaction.
 */
export async function repeatPartnerWarning(
  tx: Transaction,
  series: Series | null,
  a: Member,
  b: Member,
): Promise<boolean> {
  if (!series || series.format !== 'Individual') return false;
  for (const sid of series.sessionIds) {
    const entry = await readEntry(tx, sid, a.id);
    if (entry && entry.status !== 'cancelled' && entry.partner?.kind === 'member' && entry.partner.memberId === b.id) {
      return true;
    }
  }
  return false;
}

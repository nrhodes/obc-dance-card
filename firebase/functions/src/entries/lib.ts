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
  type NotificationType,
  type PartnerRef,
  type Programme,
  type Series,
  type Session,
  type Team,
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

/* ------------------------------- cancelEntry cascade -------------------------- */

/**
 * A notification `cancelEntryInTx` wants sent once its transaction commits.
 * Collected during the transaction (no I/O beyond `tx.get`/`tx.set`) and
 * dispatched by the caller afterwards, exactly as `cancelEntryHandler`
 * always has.
 */
export interface CancelEntryNotification {
  memberId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface CancelEntryTxResult {
  ownEntry: Entry;
  partnerEntry?: Entry;
  notify: CancelEntryNotification[];
  /** Set only on the visitor-pairing branch: the visitor to courtesy-email, if any. */
  cancelledVisitorId?: string;
}

export interface CancelEntryTxContext {
  /** memberId whose cancellation this is attributed to in notification copy (never the admin, for on-behalf/admin-cascade actions). */
  actorMemberId: string;
  actorName: string;
}

/**
 * The exact §9.3 cancel cascade, factored out of `cancelEntryHandler` so
 * `deactivateMember` (Phase 6) can drive the identical logic for every
 * future entry of a member being deactivated, inside its own transaction(s).
 * Behaviour is unchanged from the original inline version: `entry` must
 * already be a fresh, non-cancelled read from *inside* `tx` (the caller owns
 * every precondition check — ownership, session-open, locking — before
 * calling this); this function only performs the pairing/team-aware
 * cascade writes and re-validates `validatePairingGroup` before returning.
 */
export async function cancelEntryInTx(
  tx: Transaction,
  entry: Entry,
  ctx: CancelEntryTxContext,
): Promise<CancelEntryTxResult> {
  const { actorName } = ctx;
  const entryRef = db.doc(paths.entry(entry.id));
  const now = new Date().toISOString();

  // ---- team entry: cancel only this entry, notify the captain (§9.3) ----
  if (entry.teamId) {
    const teamSnap = await tx.get(db.doc(paths.team(entry.teamId)));
    const team = teamSnap.data() as Team | undefined;
    const cancelled: Entry = { ...entry, status: 'cancelled', updatedAt: now };
    tx.set(entryRef, cancelled);

    const issues = validatePairingGroup([cancelled]);
    if (issues.length > 0) {
      throw new HttpsError('internal', `Pairing invariant violated: ${issues.join('; ')}`);
    }

    const notify: CancelEntryNotification[] = [];
    if (team) {
      notify.push({
        memberId: team.captainMemberId,
        type: 'team_member_absent',
        title: 'A team member is absent',
        body: `${actorName} cannot play on ${entry.date}.`,
        data: { teamId: team.id, sessionId: entry.sessionId, memberId: entry.memberId },
      });
    }
    return { ownEntry: cancelled, notify };
  }

  // ---- visitor pairing: one-sided, cancel just this entry (plan §12.8) ----
  if (entry.partner?.kind === 'visitor') {
    const cancelled: Entry = { ...entry, status: 'cancelled', partner: null, pairingId: null, updatedAt: now };
    tx.set(entryRef, cancelled);

    const issues = validatePairingGroup([cancelled]);
    if (issues.length > 0) {
      throw new HttpsError('internal', `Pairing invariant violated: ${issues.join('; ')}`);
    }
    // Courtesy *cancellation* email (plan §9.3 / §12.4) is sent after the
    // transaction commits, once we know it did — the caller does this.
    return { ownEntry: cancelled, notify: [], cancelledVisitorId: entry.partner.visitorId };
  }

  if (!entry.pairingId) {
    throw new HttpsError('internal', 'A member-paired entry is missing its pairingId.');
  }

  const groupSnap = await tx.get(db.collection(paths.entries()).where('pairingId', '==', entry.pairingId));
  const group = groupSnap.docs.map((d) => d.data() as Entry);
  const writes: Entry[] = [];
  const notify: CancelEntryNotification[] = [];
  let partnerEntry: Entry | undefined;

  if (entry.isSubstituteFor) {
    // ---- case: the substitute themselves cancels — revert to the plain I2 shape ----
    const coveredId = entry.isSubstituteFor;
    const remainingId = entry.partner?.kind === 'member' ? entry.partner.memberId : null;
    const covered = group.find((e) => e.memberId === coveredId);
    const remaining = remainingId ? group.find((e) => e.memberId === remainingId) : undefined;
    if (!covered || !remaining) {
      throw new HttpsError('internal', 'Substitute pairing group is missing an expected entry.');
    }

    const cancelledSelf: Entry = {
      ...entry,
      status: 'cancelled',
      partner: null,
      pairingId: null,
      isSubstituteFor: null,
      updatedAt: now,
    };
    const revertedCovered: Entry = { ...covered, status: 'confirmed', substitute: null, updatedAt: now };
    const revertedRemaining: Entry = { ...remaining, partnerSubstitute: null, updatedAt: now };
    writes.push(cancelledSelf, revertedCovered, revertedRemaining);

    notify.push(
      {
        memberId: covered.memberId,
        type: 'substitute_cleared',
        title: 'Your substitute is no longer available',
        body: `${actorName} can no longer stand in for you on ${entry.date}.`,
        data: { sessionId: entry.sessionId },
      },
      {
        memberId: remaining.memberId,
        type: 'substitute_cleared',
        title: 'Your partner’s substitute is no longer available',
        body: `${actorName} can no longer stand in on ${entry.date}.`,
        data: { sessionId: entry.sessionId },
      },
    );
  } else if (entry.status === 'substituted') {
    // ---- case: the covered member leaves permanently; their stand-in is promoted (§9.3) ----
    const remainingId = entry.partner?.kind === 'member' ? entry.partner.memberId : null;
    const remaining = remainingId ? group.find((e) => e.memberId === remainingId) : undefined;
    const sub = entry.substitute;
    if (!remaining || !sub) {
      throw new HttpsError('internal', 'Substituted pairing group is missing an expected entry.');
    }

    const cancelledSelf: Entry = {
      ...entry,
      status: 'cancelled',
      partner: null,
      pairingId: null,
      substitute: null,
      updatedAt: now,
    };
    const promotedRemaining: Entry = { ...remaining, partner: sub, partnerSubstitute: null, updatedAt: now };
    writes.push(cancelledSelf, promotedRemaining);
    partnerEntry = promotedRemaining;

    if (sub.kind === 'member') {
      const subEntry = group.find((e) => e.memberId === sub.memberId && e.isSubstituteFor === entry.memberId);
      if (!subEntry) {
        throw new HttpsError('internal', 'Promoted substitute is missing their own entry.');
      }
      writes.push({ ...subEntry, isSubstituteFor: null, updatedAt: now });
    }
    notify.push({
      memberId: remaining.memberId,
      type: 'partner_cancelled',
      title: 'Your partner has withdrawn',
      body: `${actorName} has withdrawn for ${entry.date}. ${sub.displayName} is now your partner for this session.`,
      data: { sessionId: entry.sessionId, year: entry.date.slice(0, 4) },
    });
  } else {
    // ---- case: plain departure — the partner is freed to look for someone new ----
    const partnerId = entry.partner?.kind === 'member' ? entry.partner.memberId : null;
    const partner = partnerId ? group.find((e) => e.memberId === partnerId) : undefined;
    if (!partner) {
      throw new HttpsError('internal', 'Pairing group is missing the partner entry.');
    }

    const cancelledSelf: Entry = {
      ...entry,
      status: 'cancelled',
      partner: null,
      pairingId: null,
      substitute: null,
      partnerSubstitute: null,
      isSubstituteFor: null,
      updatedAt: now,
    };
    const freedPartner: Entry = {
      ...partner,
      status: 'looking_for_partner',
      partner: null,
      pairingId: null,
      substitute: null,
      partnerSubstitute: null,
      isSubstituteFor: null,
      note: undefined,
      updatedAt: now,
    };
    writes.push(cancelledSelf, freedPartner);
    partnerEntry = freedPartner;

    notify.push({
      memberId: partner.memberId,
      type: 'partner_cancelled',
      title: 'Your partner cancelled',
      body: `${actorName} cancelled for ${entry.date}. You are now looking for a partner.`,
      data: { sessionId: entry.sessionId, year: entry.date.slice(0, 4) },
    });

    const subEntry = group.find((e) => e.isSubstituteFor === partner.memberId);
    if (subEntry) {
      writes.push({ ...subEntry, status: 'cancelled', partner: null, pairingId: null, isSubstituteFor: null, updatedAt: now });
      notify.push({
        memberId: subEntry.memberId,
        type: 'partner_cancelled',
        title: 'Your substitute arrangement is cancelled',
        body: `${actorName} cancelled for ${entry.date}, so your stand-in spot is no longer needed.`,
        data: { sessionId: entry.sessionId },
      });
    }
  }

  for (const w of writes) {
    tx.set(db.doc(paths.entry(w.id)), w);
  }

  const updatedById = new Map(writes.map((w) => [w.id, w]));
  const postGroup = group.map((g) => updatedById.get(g.id) ?? g);
  const issues = validatePairingGroup(postGroup);
  if (issues.length > 0) {
    throw new HttpsError('internal', `Pairing invariant violated: ${issues.join('; ')}`);
  }

  const ownEntry = updatedById.get(entry.id)!;
  return { ownEntry, partnerEntry, notify };
}

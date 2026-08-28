/**
 * `sendInvite`, `respondToInvite`, `cancelInvite` (plan §9.2, §9.3). Every
 * pairing write happens inside one transaction via `writePair`, which
 * re-validates `validatePairingGroup` before commit (plan §7).
 */
import { randomUUID } from 'node:crypto';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  CancelInviteInputSchema,
  RespondToInviteInputSchema,
  SendInviteInputSchema,
  paths,
  sessionCutoff,
  type CancelInviteInput,
  type CancelInviteResult,
  type Entry,
  type Invite,
  type Member,
  type RespondToInviteInput,
  type RespondToInviteResult,
  type SendInviteInput,
  type SendInviteResult,
  type Series,
} from '@obc/shared';
import { db } from '../lib/admin.js';
import { audit } from '../lib/audit.js';
import { callableOptions } from '../lib/callable.js';
import { requireMember, resolveActingMember } from '../lib/context.js';
import { assertRateLimit } from '../lib/rateLimit.js';
import { createNotification } from '../notifications/create.js';
import { assertForceAllowed, assertSessionOpen, isFree, loadSession, readEntry, repeatPartnerWarning, writePair, type LoadedSession } from './lib.js';

const MAX_LISTED_CONFLICTS = 10;
const INVITE_SEND_LIMIT = 30;
const INVITE_SEND_WINDOW_SEC = 24 * 3600;
const INVITE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

/* ---------------------------------- sendInvite ------------------------------- */

export async function sendInviteHandler(req: CallableRequest<SendInviteInput>): Promise<SendInviteResult> {
  const input = SendInviteInputSchema.parse(req.data);
  const caller = await requireMember(req);
  assertForceAllowed(caller, input.force);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);
  const actorName = `${actor.member.firstName} ${actor.member.lastName}`;

  if (input.toMemberId === actor.memberId) {
    throw new HttpsError('invalid-argument', 'You cannot invite yourself.');
  }

  const toSnap = await db.doc(paths.member(input.toMemberId)).get();
  const toMember = toSnap.data() as Member | undefined;
  if (!toMember || !toMember.active) {
    throw new HttpsError('failed-precondition', 'That member is not available to invite.');
  }

  await assertRateLimit('invites:send', actor.memberId, INVITE_SEND_LIMIT, INVITE_SEND_WINDOW_SEC);

  const invite = await db.runTransaction(async (tx) => {
    let targetSessionIds: string[];
    let seriesId: string | null = null;

    if (input.scope === 'session') {
      targetSessionIds = [input.sessionId!];
    } else {
      const seriesSnap = await tx.get(db.doc(paths.seriesDoc(input.year, input.seriesId!)));
      const series = seriesSnap.data() as Series | undefined;
      if (!series) throw new HttpsError('not-found', 'Series not found.');
      seriesId = series.id;
      targetSessionIds = series.sessionIds;
    }

    const loaded: LoadedSession[] = [];
    for (const sid of targetSessionIds) {
      loaded.push(await loadSession(tx, input.year, sid));
    }

    let target = loaded;
    if (input.scope === 'series') {
      // Series invites silently drop sessions that have already locked
      // (plan design notes); every other precondition below still applies
      // to whatever remains.
      target = loaded.filter((ls) => Date.now() < sessionCutoff(ls.session.date, ls.weekday.startTime).getTime());
      if (target.length === 0) {
        throw new HttpsError('failed-precondition', 'Every session in this series has already started.');
      }
    }

    for (const ls of target) {
      assertSessionOpen(ls.session, ls.weekday, ls.programme, { force: input.force });
    }

    const conflictDates: string[] = [];
    for (const ls of target) {
      const [fromEntry, toEntry] = [
        await readEntry(tx, ls.session.id, actor.memberId),
        await readEntry(tx, ls.session.id, input.toMemberId),
      ];
      if (!isFree(fromEntry) || !isFree(toEntry)) {
        conflictDates.push(ls.session.date);
      }
    }
    if (conflictDates.length > 0) {
      throw new HttpsError(
        'failed-precondition',
        `Already committed on: ${conflictDates.slice(0, MAX_LISTED_CONFLICTS).join(', ')}.`,
      );
    }

    const targetSessionIdSet = new Set(target.map((ls) => ls.session.id));
    const pendingSnap = await tx.get(
      db
        .collection(paths.invites())
        .where('fromMemberId', '==', actor.memberId)
        .where('toMemberId', '==', input.toMemberId)
        .where('status', '==', 'pending'),
    );
    const hasDuplicate = pendingSnap.docs.some((d) => {
      const existing = d.data() as Invite;
      return existing.sessionIds.some((sid) => targetSessionIdSet.has(sid));
    });
    if (hasDuplicate) {
      throw new HttpsError('failed-precondition', 'You already have a pending invite to that member for one of these sessions.');
    }

    const inviteId = randomUUID();
    const now = new Date().toISOString();
    const first = target[0]!;
    const expiresAt = new Date(
      Math.min(Date.now() + INVITE_MAX_AGE_MS, sessionCutoff(first.session.date, first.weekday.startTime).getTime()),
    ).toISOString();

    const doc: Invite = {
      id: inviteId,
      scope: input.scope,
      year: input.year,
      sessionIds: target.map((ls) => ls.session.id),
      seriesId,
      teamId: null,
      fromMemberId: actor.memberId,
      toMemberId: input.toMemberId,
      status: 'pending',
      createdBy: caller.uid,
      onBehalfBy: actor.onBehalfBy,
      expiresAt,
      message: input.message,
      createdAt: now,
      updatedAt: now,
    };
    tx.set(db.doc(paths.invite(inviteId)), doc);
    return doc;
  });

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'send_invite_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: paths.invite(invite.id),
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin sent an invite for you',
      `An admin sent an invite to ${toMember.firstName} ${toMember.lastName} on your behalf.`,
      { inviteId: invite.id },
    );
  }

  await createNotification(
    invite.toMemberId,
    'invite_received',
    'You have a new partner invite',
    `${actorName} would like to play with you.`,
    { inviteId: invite.id, sessionId: invite.sessionIds[0]!, year: String(input.year) },
  );

  return { invite };
}

export const sendInvite = onCall(callableOptions, sendInviteHandler);

/* -------------------------------- respondToInvite ---------------------------- */

export async function respondToInviteHandler(
  req: CallableRequest<RespondToInviteInput>,
): Promise<RespondToInviteResult> {
  const input = RespondToInviteInputSchema.parse(req.data);
  const caller = await requireMember(req);
  assertForceAllowed(caller, input.force);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);
  const actorName = `${actor.member.firstName} ${actor.member.lastName}`;
  const inviteRef = db.doc(paths.invite(input.inviteId));

  if (!input.accept) {
    const invite = await db.runTransaction(async (tx) => {
      const snap = await tx.get(inviteRef);
      const inv = snap.data() as Invite | undefined;
      if (!inv) throw new HttpsError('not-found', 'Invite not found.');
      if (inv.toMemberId !== actor.memberId) {
        throw new HttpsError('permission-denied', 'This invite is not addressed to you.');
      }
      if (inv.status !== 'pending') {
        throw new HttpsError('failed-precondition', 'This invite is no longer pending.');
      }
      const now = new Date().toISOString();
      const updated: Invite = { ...inv, status: 'declined', respondedAt: now, updatedAt: now };
      tx.set(inviteRef, updated);
      return updated;
    });

    if (actor.onBehalfBy) {
      await audit({
        actorMemberId: actor.onBehalfBy,
        action: 'respond_to_invite_on_behalf',
        targetMemberId: actor.memberId,
        entityRef: inviteRef.path,
      });
      await createNotification(
        actor.memberId,
        'on_behalf_action',
        'An admin declined an invite for you',
        'An admin declined a partner invite on your behalf.',
        { inviteId: invite.id },
      );
    }
    await createNotification(
      invite.fromMemberId,
      'invite_declined',
      'Your invite was declined',
      `${actorName} declined your invite.`,
      { inviteId: invite.id },
    );
    return { invite, entries: [] };
  }

  // A transaction that throws commits none of its writes (including any
  // `tx.set` called before the throw) — so marking an expired invite as
  // `expired` has to happen in its own transaction, separate from the one
  // that then reports the failure to the caller.
  const expiredJustNow = await db.runTransaction(async (tx) => {
    const snap = await tx.get(inviteRef);
    const inv = snap.data() as Invite | undefined;
    if (!inv) throw new HttpsError('not-found', 'Invite not found.');
    if (inv.toMemberId !== actor.memberId) {
      throw new HttpsError('permission-denied', 'This invite is not addressed to you.');
    }
    if (inv.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'This invite is no longer pending.');
    }
    if (new Date(inv.expiresAt).getTime() < Date.now()) {
      tx.set(inviteRef, { ...inv, status: 'expired', updatedAt: new Date().toISOString() });
      return true;
    }
    return false;
  });
  if (expiredJustNow) {
    throw new HttpsError('failed-precondition', 'This invite has expired.');
  }

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(inviteRef);
    const inv = snap.data() as Invite | undefined;
    if (!inv) throw new HttpsError('not-found', 'Invite not found.');
    if (inv.toMemberId !== actor.memberId) {
      throw new HttpsError('permission-denied', 'This invite is not addressed to you.');
    }
    if (inv.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'This invite is no longer pending.');
    }

    // ---- reads: sessions, members, free-check, repeat-partner, other pending invites ----
    const loaded: LoadedSession[] = [];
    for (const sid of inv.sessionIds) {
      loaded.push(await loadSession(tx, inv.year, sid));
    }
    for (const ls of loaded) {
      assertSessionOpen(ls.session, ls.weekday, ls.programme, { force: input.force });
    }

    const fromSnap = await tx.get(db.doc(paths.member(inv.fromMemberId)));
    const fromMember = fromSnap.data() as Member | undefined;
    if (!fromMember || !fromMember.active) {
      throw new HttpsError('failed-precondition', 'The sender is no longer an active member.');
    }
    const toSnap = await tx.get(db.doc(paths.member(actor.memberId)));
    const toMember = toSnap.data() as Member;

    const conflictDates: string[] = [];
    for (const ls of loaded) {
      const [fromEntry, toEntry] = [
        await readEntry(tx, ls.session.id, inv.fromMemberId),
        await readEntry(tx, ls.session.id, actor.memberId),
      ];
      if (!isFree(fromEntry) || !isFree(toEntry)) {
        conflictDates.push(ls.session.date);
      }
    }
    if (conflictDates.length > 0) {
      throw new HttpsError(
        'failed-precondition',
        `Conflicting session(s): ${conflictDates.slice(0, MAX_LISTED_CONFLICTS).join(', ')}. The invite is still pending.`,
      );
    }

    const seriesForWarning = loaded.find((ls) => ls.series)?.series ?? null;
    const warning = await repeatPartnerWarning(tx, seriesForWarning, fromMember, toMember);

    const otherPendingSnap = await tx.get(db.collection(paths.invites()).where('status', '==', 'pending'));
    const sessionIdSet = new Set(inv.sessionIds);
    const toExpire = otherPendingSnap.docs
      .map((d) => d.data() as Invite)
      .filter(
        (other) =>
          other.id !== inv.id &&
          (other.fromMemberId === inv.fromMemberId ||
            other.toMemberId === inv.fromMemberId ||
            other.fromMemberId === actor.memberId ||
            other.toMemberId === actor.memberId) &&
          other.sessionIds.some((sid) => sessionIdSet.has(sid)),
      );

    // ---- writes ----
    const entries: Entry[] = [];
    for (const ls of loaded) {
      const { entryA, entryB } = await writePair(tx, {
        session: ls.session,
        a: fromMember,
        b: toMember,
        createdBy: actor.memberId,
        onBehalfBy: actor.onBehalfBy,
      });
      entries.push(entryA, entryB);
    }

    const now = new Date().toISOString();
    const acceptedInvite: Invite = { ...inv, status: 'accepted', respondedAt: now, updatedAt: now };
    tx.set(inviteRef, acceptedInvite);

    for (const other of toExpire) {
      tx.set(db.doc(paths.invite(other.id)), { ...other, status: 'expired', updatedAt: now });
    }

    return { invite: acceptedInvite, entries, warning, expired: toExpire };
  });

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'respond_to_invite_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: inviteRef.path,
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin accepted an invite for you',
      'An admin accepted a partner invite on your behalf.',
      { inviteId: result.invite.id },
    );
  }
  await createNotification(
    result.invite.fromMemberId,
    'invite_accepted',
    'Your invite was accepted',
    `${actorName} accepted your invite.`,
    { inviteId: result.invite.id },
  );
  for (const other of result.expired) {
    await createNotification(
      other.fromMemberId,
      'invite_expired',
      'Your invite expired',
      'The member you invited has already been paired for that session.',
      { inviteId: other.id },
    );
  }

  return { invite: result.invite, entries: result.entries, repeatPartnerWarning: result.warning };
}

export const respondToInvite = onCall(callableOptions, respondToInviteHandler);

/* --------------------------------- cancelInvite ------------------------------ */

export async function cancelInviteHandler(req: CallableRequest<CancelInviteInput>): Promise<CancelInviteResult> {
  const input = CancelInviteInputSchema.parse(req.data);
  const caller = await requireMember(req);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);
  const actorName = `${actor.member.firstName} ${actor.member.lastName}`;
  const inviteRef = db.doc(paths.invite(input.inviteId));

  const invite = await db.runTransaction(async (tx) => {
    const snap = await tx.get(inviteRef);
    const inv = snap.data() as Invite | undefined;
    if (!inv) throw new HttpsError('not-found', 'Invite not found.');
    if (inv.fromMemberId !== actor.memberId) {
      throw new HttpsError('permission-denied', 'This invite was not sent by you.');
    }
    if (inv.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'This invite is no longer pending.');
    }
    const now = new Date().toISOString();
    const updated: Invite = { ...inv, status: 'cancelled', updatedAt: now };
    tx.set(inviteRef, updated);
    return updated;
  });

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'cancel_invite_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: inviteRef.path,
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin cancelled an invite for you',
      'An admin cancelled a partner invite you had sent.',
      { inviteId: invite.id },
    );
  }
  await createNotification(
    invite.toMemberId,
    'invite_cancelled',
    'An invite was cancelled',
    `${actorName} cancelled their invite to you.`,
    { inviteId: invite.id },
  );

  return { invite };
}

export const cancelInvite = onCall(callableOptions, cancelInviteHandler);

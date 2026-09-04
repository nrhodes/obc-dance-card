/**
 * `setSubstitute` / `clearSubstitute` (plan §9.2, §7 I4, §12.7/§12.8). Either
 * partner may record a one-week substitute for the *other* side of a
 * member–member pairing (`coverFor: 'self' | 'partner'`, default `'self'`);
 * a visitor pairing can never be substituted (§12.8 — cancel and re-pair
 * instead). Every write re-validates `validatePairingGroup` before commit.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  ClearSubstituteInputSchema,
  SetSubstituteInputSchema,
  paths,
  validatePairingGroup,
  type ClearSubstituteInput,
  type ClearSubstituteResult,
  type Entry,
  type Member,
  type PartnerRef,
  type SetSubstituteInput,
  type SetSubstituteResult,
  type Visitor,
} from '@obc/shared';
import { db } from '../lib/admin.js';
import { audit } from '../lib/audit.js';
import { callableOptions } from '../lib/callable.js';
import { requireMember, resolveActingMember } from '../lib/context.js';
import { parseInput } from '../lib/parseInput.js';
import { createNotification } from '../notifications/create.js';
import { assertForceAllowed, assertSessionOpen, entryId, isFree, loadSession, memberRef, readEntry } from './lib.js';

/* -------------------------------- setSubstitute ------------------------------- */

interface ResolvedPair {
  covered: Entry;
  remaining: Entry;
}

/**
 * `entryId` always names the *caller's own* entry. `coverFor` says whether
 * the caller is the one being covered (`'self'`, default — a sub is arranged
 * for the caller) or is the remaining partner arranging a sub for the other
 * side (`'partner'`) — plan §9.2 design notes: "either party may record it".
 */
async function resolvePairForSubstitute(
  tx: FirebaseFirestore.Transaction,
  callerEntryId: string,
  actorMemberId: string,
  coverFor: 'self' | 'partner',
): Promise<ResolvedPair> {
  const callerSnap = await tx.get(db.doc(paths.entry(callerEntryId)));
  const callerEntry = callerSnap.data() as Entry | undefined;
  if (!callerEntry) throw new HttpsError('not-found', 'Entry not found.');
  if (callerEntry.memberId !== actorMemberId) {
    throw new HttpsError('permission-denied', 'This entry does not belong to you.');
  }
  if (callerEntry.status !== 'confirmed') {
    throw new HttpsError('failed-precondition', 'This entry is not an active pairing.');
  }
  if (callerEntry.partner?.kind !== 'member') {
    throw new HttpsError(
      'failed-precondition',
      'A visitor pairing cannot be substituted — cancel and sign up again instead (plan §12.8).',
    );
  }
  if (!callerEntry.pairingId) {
    throw new HttpsError('internal', 'A member-paired entry is missing its pairingId.');
  }

  const partnerEntry = await readEntry(tx, callerEntry.sessionId, callerEntry.partner.memberId);
  if (!partnerEntry) {
    throw new HttpsError('internal', 'Partner entry is missing.');
  }

  return coverFor === 'partner' ? { covered: partnerEntry, remaining: callerEntry } : { covered: callerEntry, remaining: partnerEntry };
}

export async function setSubstituteHandler(req: CallableRequest<SetSubstituteInput>): Promise<SetSubstituteResult> {
  const input = parseInput(SetSubstituteInputSchema, req.data);
  const caller = await requireMember(req);
  assertForceAllowed(caller, input.force);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);
  const coverFor = input.coverFor ?? 'self';

  const result = await db.runTransaction(async (tx) => {
    const { covered, remaining } = await resolvePairForSubstitute(tx, input.entryId, actor.memberId, coverFor);

    if (covered.status !== 'confirmed' || covered.substitute || remaining.partnerSubstitute) {
      throw new HttpsError('failed-precondition', 'This pairing already has a substitute arranged.');
    }

    const year = Number(covered.date.slice(0, 4));
    const loaded = await loadSession(tx, year, covered.sessionId);
    if (!loaded.series || !loaded.series.allowSubstitute) {
      throw new HttpsError('failed-precondition', 'This series does not allow substitutes.');
    }
    assertSessionOpen(loaded.session, loaded.weekday, loaded.programme, { force: input.force });

    const now = new Date().toISOString();
    let subRef: PartnerRef;
    let subEntryWrite: Entry | undefined;

    if (input.substitute.kind === 'member') {
      const subMemberId = input.substitute.memberId;
      if (subMemberId === covered.memberId || subMemberId === remaining.memberId) {
        throw new HttpsError('invalid-argument', 'The substitute cannot be one of the players already in this pairing.');
      }
      const subSnap = await tx.get(db.doc(paths.member(subMemberId)));
      const subMember = subSnap.data() as Member | undefined;
      if (!subMember || !subMember.active) {
        throw new HttpsError('failed-precondition', 'That member is not available.');
      }
      // Review-cohort partition (plan §8.1, decided 2026-09-05): a substitute
      // must belong to the same cohort as the pairing they're covering.
      if (subMember.cohort !== covered.cohort) {
        throw new HttpsError('failed-precondition', 'That member is not available.');
      }
      const subExisting = await readEntry(tx, covered.sessionId, subMemberId);
      if (!isFree(subExisting)) {
        throw new HttpsError('failed-precondition', 'That member already has an entry for this session.');
      }

      const remainingMemberSnap = await tx.get(db.doc(paths.member(remaining.memberId)));
      const remainingMember = remainingMemberSnap.data() as Member;

      subRef = memberRef(subMember);
      subEntryWrite = {
        id: entryId(covered.sessionId, subMemberId),
        sessionId: covered.sessionId,
        date: covered.date,
        weekday: covered.weekday,
        seriesId: covered.seriesId,
        memberId: subMemberId,
        cohort: subMember.cohort,
        status: 'confirmed',
        partner: memberRef(remainingMember),
        pairingId: covered.pairingId,
        teamId: null,
        teamSessionOnly: false,
        substitute: null,
        partnerSubstitute: null,
        isSubstituteFor: covered.memberId,
        createdBy: actor.memberId,
        onBehalfBy: actor.onBehalfBy,
        createdAt: subExisting?.createdAt ?? now,
        updatedAt: now,
      };
    } else {
      const visitorSnap = await tx.get(db.doc(paths.visitor(input.substitute.visitorId)));
      const visitor = visitorSnap.data() as Visitor | undefined;
      if (!visitor) throw new HttpsError('not-found', 'Visitor not found.');
      if (visitor.createdByMemberId !== actor.memberId && visitor.createdByMemberId !== remaining.memberId) {
        throw new HttpsError('permission-denied', 'You may only bring a visitor sponsored by you or your partner.');
      }
      subRef = { kind: 'visitor', visitorId: visitor.id, displayName: visitor.displayName };
    }

    const updatedCovered: Entry = { ...covered, status: 'substituted', substitute: subRef, updatedAt: now };
    const updatedRemaining: Entry = { ...remaining, partnerSubstitute: subRef, updatedAt: now };

    tx.set(db.doc(paths.entry(updatedCovered.id)), updatedCovered);
    tx.set(db.doc(paths.entry(updatedRemaining.id)), updatedRemaining);
    if (subEntryWrite) tx.set(db.doc(paths.entry(subEntryWrite.id)), subEntryWrite);

    const group = [updatedCovered, updatedRemaining, ...(subEntryWrite ? [subEntryWrite] : [])];
    const issues = validatePairingGroup(group);
    if (issues.length > 0) {
      throw new HttpsError('internal', `Pairing invariant violated: ${issues.join('; ')}`);
    }

    return { covered: updatedCovered, remaining: updatedRemaining, sub: subEntryWrite, subRef };
  });

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'set_substitute_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: paths.entry(input.entryId),
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin arranged a substitute for you',
      `An admin arranged ${result.subRef.displayName} as a substitute on your behalf.`,
      { entryId: input.entryId },
    );
  }

  // The covered member's name, from the remaining entry's (unchanged) partner
  // ref, and vice versa — both already denormalised, no extra reads needed.
  const coveredName = result.remaining.partner?.displayName ?? 'your partner';
  const remainingName = result.covered.partner?.displayName ?? 'your partner';

  if (result.sub) {
    await createNotification(
      result.sub.memberId,
      'substitute_arranged',
      "You're standing in for a partner",
      `You're standing in for ${coveredName} with ${remainingName} on ${result.covered.date}.`,
      { sessionId: result.covered.sessionId },
    );
  }

  const otherPartyId = actor.memberId === result.covered.memberId ? result.remaining.memberId : result.covered.memberId;
  await createNotification(
    otherPartyId,
    'substitute_arranged',
    'A substitute has been arranged',
    `${result.subRef.displayName} will stand in on ${result.covered.date}.`,
    { sessionId: result.covered.sessionId },
  );

  const entries = [result.covered, result.remaining, ...(result.sub ? [result.sub] : [])];
  return { entries };
}

export const setSubstitute = onCall(callableOptions, setSubstituteHandler);

/* -------------------------------- clearSubstitute ------------------------------- */

export async function clearSubstituteHandler(req: CallableRequest<ClearSubstituteInput>): Promise<ClearSubstituteResult> {
  const input = parseInput(ClearSubstituteInputSchema, req.data);
  const caller = await requireMember(req);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);

  const result = await db.runTransaction(async (tx) => {
    const entrySnap = await tx.get(db.doc(paths.entry(input.entryId)));
    const entry = entrySnap.data() as Entry | undefined;
    if (!entry) throw new HttpsError('not-found', 'Entry not found.');
    if (entry.memberId !== actor.memberId) {
      throw new HttpsError('permission-denied', 'This entry does not belong to you.');
    }
    if (entry.isSubstituteFor) {
      // The sub's own entry — plan §9.2: a sub who withdraws uses `cancelEntry`,
      // which already restores I2 (see its `isSubstituteFor` branch).
      throw new HttpsError('permission-denied', 'The substitute cannot clear this — ask a partner, or cancel your own entry.');
    }
    if (entry.partner?.kind !== 'member') {
      throw new HttpsError('failed-precondition', 'There is no substitute to clear here.');
    }

    const partnerEntry = await readEntry(tx, entry.sessionId, entry.partner.memberId);
    if (!partnerEntry) throw new HttpsError('internal', 'Partner entry is missing.');

    const covered = entry.status === 'substituted' ? entry : partnerEntry;
    const remaining = entry.status === 'substituted' ? partnerEntry : entry;

    if (covered.status !== 'substituted' || !covered.substitute) {
      throw new HttpsError('failed-precondition', 'There is no substitute arranged for this pairing.');
    }

    // All reads (including the sub's own entry, if any) must happen before
    // any writes — Firestore transactions require reads-then-writes.
    let existingSub: Entry | undefined;
    if (covered.substitute.kind === 'member') {
      existingSub = (await readEntry(tx, covered.sessionId, covered.substitute.memberId)) ?? undefined;
    }

    const now = new Date().toISOString();
    const revertedCovered: Entry = { ...covered, status: 'confirmed', substitute: null, updatedAt: now };
    const revertedRemaining: Entry = { ...remaining, partnerSubstitute: null, updatedAt: now };
    tx.set(db.doc(paths.entry(revertedCovered.id)), revertedCovered);
    tx.set(db.doc(paths.entry(revertedRemaining.id)), revertedRemaining);

    let subEntry: Entry | undefined;
    if (existingSub) {
      subEntry = { ...existingSub, status: 'cancelled', partner: null, pairingId: null, isSubstituteFor: null, updatedAt: now };
      tx.set(db.doc(paths.entry(subEntry.id)), subEntry);
    }

    const group = [revertedCovered, revertedRemaining, ...(subEntry ? [subEntry] : [])];
    const issues = validatePairingGroup(group);
    if (issues.length > 0) {
      throw new HttpsError('internal', `Pairing invariant violated: ${issues.join('; ')}`);
    }

    return { covered: revertedCovered, remaining: revertedRemaining, sub: subEntry };
  });

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'clear_substitute_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: paths.entry(input.entryId),
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin cleared a substitute for you',
      'An admin cleared a substitute arrangement on your behalf.',
      { entryId: input.entryId },
    );
  }

  if (result.sub) {
    await createNotification(
      result.sub.memberId,
      'substitute_cleared',
      'Your stand-in arrangement was cleared',
      `You are no longer standing in on ${result.covered.date}.`,
      { sessionId: result.covered.sessionId },
    );
  }
  const otherPartyId = actor.memberId === result.covered.memberId ? result.remaining.memberId : result.covered.memberId;
  await createNotification(
    otherPartyId,
    'substitute_cleared',
    'The substitute arrangement was cleared',
    `The substitute for ${result.covered.date} is no longer standing in.`,
    { sessionId: result.covered.sessionId },
  );

  const entries = [result.covered, result.remaining, ...(result.sub ? [result.sub] : [])];
  return { entries };
}

export const clearSubstitute = onCall(callableOptions, clearSubstituteHandler);

/**
 * `setSoloStatus`, `clearSoloStatus`, `claimLookingForPartner`, `cancelEntry`
 * (plan §9.2, §9.3 cancel cascade "law"). `cancelEntry` implements every
 * branch of §9.3 exactly and re-validates `validatePairingGroup` over the
 * whole affected pairing group before commit.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  CancelEntryInputSchema,
  ClaimLookingForPartnerInputSchema,
  ClearSoloStatusInputSchema,
  SetSoloStatusInputSchema,
  paths,
  validatePairingGroup,
  type CancelEntryInput,
  type CancelEntryResult,
  type ClaimLookingForPartnerInput,
  type ClaimLookingForPartnerResult,
  type ClearSoloStatusInput,
  type ClearSoloStatusResult,
  type Entry,
  type Member,
  type NotificationType,
  type SetSoloStatusInput,
  type SetSoloStatusResult,
  type Team,
} from '@obc/shared';
import { db } from '../lib/admin.js';
import { audit } from '../lib/audit.js';
import { callableOptions } from '../lib/callable.js';
import { requireMember, resolveActingMember } from '../lib/context.js';
import { createNotification } from '../notifications/create.js';
import { assertForceAllowed, assertSessionOpen, entryId, isFree, loadSession, readEntry, repeatPartnerWarning, writePair } from './lib.js';

/* -------------------------------- setSoloStatus ------------------------------ */

export async function setSoloStatusHandler(req: CallableRequest<SetSoloStatusInput>): Promise<SetSoloStatusResult> {
  const input = SetSoloStatusInputSchema.parse(req.data);
  const caller = await requireMember(req);
  assertForceAllowed(caller, input.force);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);

  const entry = await db.runTransaction(async (tx) => {
    const loaded = await loadSession(tx, input.year, input.sessionId);
    assertSessionOpen(loaded.session, loaded.weekday, loaded.programme, { force: input.force });

    const existing = await readEntry(tx, input.sessionId, actor.memberId);
    if (!isFree(existing)) {
      throw new HttpsError('failed-precondition', 'You already have an entry for this session.');
    }

    const now = new Date().toISOString();
    const doc: Entry = {
      id: entryId(input.sessionId, actor.memberId),
      sessionId: loaded.session.id,
      date: loaded.session.date,
      weekday: loaded.session.weekday,
      seriesId: loaded.session.seriesId,
      memberId: actor.memberId,
      status: input.status,
      partner: null,
      pairingId: null,
      teamId: null,
      teamSessionOnly: false,
      substitute: null,
      partnerSubstitute: null,
      isSubstituteFor: null,
      note: input.note,
      createdBy: caller.uid,
      onBehalfBy: actor.onBehalfBy,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    tx.set(db.doc(paths.entry(doc.id)), doc);
    return doc;
  });

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'set_solo_status_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: paths.entry(entry.id),
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin updated your noticeboard listing',
      `An admin listed you as "${input.status === 'looking_for_partner' ? 'looking for a partner' : 'available'}" for a session.`,
      { entryId: entry.id },
    );
  }

  return { entry };
}

export const setSoloStatus = onCall(callableOptions, setSoloStatusHandler);

/* -------------------------------- clearSoloStatus ----------------------------- */

export async function clearSoloStatusHandler(
  req: CallableRequest<ClearSoloStatusInput>,
): Promise<ClearSoloStatusResult> {
  const input = ClearSoloStatusInputSchema.parse(req.data);
  const caller = await requireMember(req);
  assertForceAllowed(caller, input.force);

  const entry = await db.runTransaction(async (tx) => {
    const loaded = await loadSession(tx, input.year, input.sessionId);
    assertSessionOpen(loaded.session, loaded.weekday, loaded.programme, { force: input.force });

    const existing = await readEntry(tx, input.sessionId, caller.uid);
    if (!existing || (existing.status !== 'looking_for_partner' && existing.status !== 'available')) {
      throw new HttpsError('failed-precondition', 'You do not have a noticeboard listing for this session.');
    }

    const now = new Date().toISOString();
    const updated: Entry = { ...existing, status: 'cancelled', updatedAt: now };
    tx.set(db.doc(paths.entry(existing.id)), updated);
    return updated;
  });

  return { entry };
}

export const clearSoloStatus = onCall(callableOptions, clearSoloStatusHandler);

/* --------------------------- claimLookingForPartner --------------------------- */

export async function claimLookingForPartnerHandler(
  req: CallableRequest<ClaimLookingForPartnerInput>,
): Promise<ClaimLookingForPartnerResult> {
  const input = ClaimLookingForPartnerInputSchema.parse(req.data);
  const caller = await requireMember(req);
  assertForceAllowed(caller, input.force);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);
  const actorName = `${actor.member.firstName} ${actor.member.lastName}`;

  if (input.posterMemberId === actor.memberId) {
    throw new HttpsError('invalid-argument', 'You cannot claim your own listing.');
  }

  const result = await db.runTransaction(async (tx) => {
    const loaded = await loadSession(tx, input.year, input.sessionId);
    assertSessionOpen(loaded.session, loaded.weekday, loaded.programme, { force: input.force });
    if (loaded.session.format === 'Teams') {
      throw new HttpsError(
        'failed-precondition',
        'This is a teams event — only a captain with space can claim a "looking for a team" listing.',
      );
    }

    const posterEntry = await readEntry(tx, input.sessionId, input.posterMemberId);
    if (!posterEntry || posterEntry.status !== 'looking_for_partner') {
      throw new HttpsError('failed-precondition', 'That listing is no longer available.');
    }
    const claimerEntry = await readEntry(tx, input.sessionId, actor.memberId);
    if (!isFree(claimerEntry)) {
      throw new HttpsError('failed-precondition', 'You already have an entry for this session.');
    }

    const posterSnap = await tx.get(db.doc(paths.member(input.posterMemberId)));
    const poster = posterSnap.data() as Member | undefined;
    if (!poster || !poster.active) {
      throw new HttpsError('failed-precondition', 'That member is no longer active.');
    }
    const claimerSnap = await tx.get(db.doc(paths.member(actor.memberId)));
    const claimer = claimerSnap.data() as Member;

    const warning = await repeatPartnerWarning(tx, loaded.series, poster, claimer);

    const { entryA, entryB } = await writePair(tx, {
      session: loaded.session,
      a: poster,
      b: claimer,
      createdBy: actor.memberId,
      onBehalfBy: actor.onBehalfBy,
    });

    return { entries: [entryA, entryB], warning, poster };
  });

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'claim_looking_for_partner_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: paths.entry(entryId(input.sessionId, actor.memberId)),
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin claimed a partner listing for you',
      `An admin paired you with ${result.poster.firstName} ${result.poster.lastName} on your behalf.`,
      { sessionId: input.sessionId },
    );
  }
  await createNotification(
    result.poster.id,
    'claimed',
    'Someone claimed your listing',
    `${actorName} will play with you.`,
    { sessionId: input.sessionId, year: String(input.year) },
  );

  return { entries: result.entries, repeatPartnerWarning: result.warning };
}

export const claimLookingForPartner = onCall(callableOptions, claimLookingForPartnerHandler);

/* ------------------------------------ cancelEntry ----------------------------- */

interface PendingNotification {
  memberId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, string>;
}

interface CancelEntryTxResult {
  ownEntry: Entry;
  partnerEntry?: Entry;
  notify: PendingNotification[];
}

export async function cancelEntryHandler(req: CallableRequest<CancelEntryInput>): Promise<CancelEntryResult> {
  const input = CancelEntryInputSchema.parse(req.data);
  const caller = await requireMember(req);
  assertForceAllowed(caller, input.force);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);
  const actorName = `${actor.member.firstName} ${actor.member.lastName}`;
  const entryRef = db.doc(paths.entry(input.entryId));

  const result = await db.runTransaction<CancelEntryTxResult>(async (tx) => {
    const entrySnap = await tx.get(entryRef);
    const entry = entrySnap.data() as Entry | undefined;
    if (!entry) throw new HttpsError('not-found', 'Entry not found.');
    if (entry.memberId !== actor.memberId) {
      throw new HttpsError('permission-denied', 'This entry does not belong to you.');
    }
    if (entry.status === 'cancelled') {
      throw new HttpsError('failed-precondition', 'This entry is already cancelled.');
    }

    const year = Number(entry.date.slice(0, 4));
    const loaded = await loadSession(tx, year, entry.sessionId);
    // `allowTeamsSession: true` — cancelling one's own entry (including a
    // Teams member's single-session absence, §9.3) is not a pairing action,
    // so the "this is a teams event" rejection in `assertSessionOpen` must
    // not apply here. See that function's doc comment.
    assertSessionOpen(loaded.session, loaded.weekday, loaded.programme, { force: input.force, allowTeamsSession: true });

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

      const notify: PendingNotification[] = [];
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
      // Courtesy email to the visitor (if opted in) is a Phase 5 concern (email adapter).
      return { ownEntry: cancelled, notify: [] };
    }

    if (!entry.pairingId) {
      throw new HttpsError('internal', 'A member-paired entry is missing its pairingId.');
    }

    const groupSnap = await tx.get(db.collection(paths.entries()).where('pairingId', '==', entry.pairingId));
    const group = groupSnap.docs.map((d) => d.data() as Entry);
    const writes: Entry[] = [];
    const notify: PendingNotification[] = [];
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
        data: { sessionId: entry.sessionId, year: String(year) },
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
        data: { sessionId: entry.sessionId, year: String(year) },
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
  });

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'cancel_entry_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: entryRef.path,
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin cancelled an entry for you',
      `An admin cancelled your entry for ${result.ownEntry.date}.`,
      { entryId: result.ownEntry.id },
    );
  }

  for (const n of result.notify) {
    await createNotification(n.memberId, n.type, n.title, n.body, n.data);
  }

  return { entry: result.ownEntry, partnerEntry: result.partnerEntry };
}

export const cancelEntry = onCall(callableOptions, cancelEntryHandler);

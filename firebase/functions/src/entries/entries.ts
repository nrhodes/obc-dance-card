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
  type CancelEntryInput,
  type CancelEntryResult,
  type ClaimLookingForPartnerInput,
  type ClaimLookingForPartnerResult,
  type ClearSoloStatusInput,
  type ClearSoloStatusResult,
  type Entry,
  type Member,
  type SetSoloStatusInput,
  type SetSoloStatusResult,
  type Team,
  type Visitor,
} from '@obc/shared';
import { db } from '../lib/admin.js';
import { audit } from '../lib/audit.js';
import { callableOptions } from '../lib/callable.js';
import { requireMember, resolveActingMember } from '../lib/context.js';
import { createNotification } from '../notifications/create.js';
import { sendMatchmakingAlerts } from '../notifications/matchmaking.js';
import { getEmailProvider } from '../email/provider.js';
import { visitorCancelledEmail } from '../email/templates/visitorCourtesy.js';
import {
  assertForceAllowed,
  assertSessionOpen,
  cancelEntryInTx,
  entryId,
  isFree,
  loadSession,
  memberRef,
  readEntry,
  repeatPartnerWarning,
  writePair,
  type CancelEntryTxResult,
} from './lib.js';
import { parseInput } from '../lib/parseInput.js';
import {
  assertTeamValid,
  loadTeamEntries,
  memberTeamInSeries,
  mergeEntries,
  refreshTeamStatus,
  seriesSessions,
  unlockedSessions,
  writeTeamEntries,
} from '../teams/lib.js';

/* -------------------------------- setSoloStatus ------------------------------ */

export async function setSoloStatusHandler(req: CallableRequest<SetSoloStatusInput>): Promise<SetSoloStatusResult> {
  const input = parseInput(SetSoloStatusInputSchema, req.data);
  const caller = await requireMember(req);
  assertForceAllowed(caller, input.force);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);

  const { entry, sessionFormat } = await db.runTransaction(async (tx) => {
    const loaded = await loadSession(tx, input.year, input.sessionId);
    // `allowTeamsSession: true` — plan §12A.4: on a Teams session this posts
    // "Looking for a team" / "Available for a team" instead of a pairing
    // listing, so the "this is a teams event" rejection must not apply here.
    assertSessionOpen(loaded.session, loaded.weekday, loaded.programme, { force: input.force, allowTeamsSession: true });

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
    return { entry: doc, sessionFormat: loaded.session.format };
  });

  // Matchmaking alerts (plan §9.2 "Notify" column, task brief §B): fires for
  // "looking for a partner" on any Pairs/Teams session — not Individual,
  // where members already arrange their own weekly partner (plan §2) and a
  // club-wide alert would be noise. `sessionFormat` is `undefined` for a
  // non-series singles/holiday session; treated the same as Pairs.
  if (input.status === 'looking_for_partner' && sessionFormat !== 'Individual') {
    await sendMatchmakingAlerts({
      posterMemberId: actor.memberId,
      posterName: `${actor.member.firstName} ${actor.member.lastName}`,
      sessionId: input.sessionId,
      date: entry.date,
    });
  }

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
  const input = parseInput(ClearSoloStatusInputSchema, req.data);
  const caller = await requireMember(req);
  assertForceAllowed(caller, input.force);

  const entry = await db.runTransaction(async (tx) => {
    const loaded = await loadSession(tx, input.year, input.sessionId);
    assertSessionOpen(loaded.session, loaded.weekday, loaded.programme, { force: input.force, allowTeamsSession: true });

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
  const input = parseInput(ClaimLookingForPartnerInputSchema, req.data);
  const caller = await requireMember(req);
  assertForceAllowed(caller, input.force);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);
  const actorName = `${actor.member.firstName} ${actor.member.lastName}`;

  if (input.posterMemberId === actor.memberId) {
    throw new HttpsError('invalid-argument', 'You cannot claim your own listing.');
  }

  const result = await db.runTransaction(async (tx) => {
    const loaded = await loadSession(tx, input.year, input.sessionId);
    assertSessionOpen(loaded.session, loaded.weekday, loaded.programme, { force: input.force, allowTeamsSession: true });

    // ---- Teams (plan §12A.4): only a captain with space may claim a
    // "looking for a team" listing, and claiming adds the poster to the
    // captain's roster for the *whole series*, not just this session. ----
    if (loaded.session.format === 'Teams') {
      if (!loaded.series) {
        throw new HttpsError('internal', 'A Teams session is missing its series.');
      }
      const series = loaded.series;
      const posterEntry = await readEntry(tx, input.sessionId, input.posterMemberId);
      if (!posterEntry || posterEntry.status !== 'looking_for_partner') {
        throw new HttpsError('failed-precondition', 'That listing is no longer available.');
      }
      const posterSnap = await tx.get(db.doc(paths.member(input.posterMemberId)));
      const poster = posterSnap.data() as Member | undefined;
      if (!poster || !poster.active) {
        throw new HttpsError('failed-precondition', 'That member is no longer active.');
      }

      // Look the caller's team up by membership, not by the deterministic id:
      // after a captaincy transfer the doc keeps the original captain's id.
      const team = await memberTeamInSeries(tx, series.id, actor.memberId);
      if (!team || team.status === 'disbanded' || team.captainMemberId !== actor.memberId) {
        throw new HttpsError(
          'failed-precondition',
          'You must captain a team in this series with space to claim this listing.',
        );
      }
      if (team.members.length >= series.teamMax) {
        throw new HttpsError('failed-precondition', 'Your team is full.');
      }
      if (await memberTeamInSeries(tx, series.id, poster.id)) {
        throw new HttpsError('failed-precondition', 'That member is already on a team for this series.');
      }

      const sessions = await seriesSessions(tx, input.year, series);
      const openSessions = unlockedSessions(sessions, loaded.weekday, loaded.programme, { force: input.force });
      const existingEntries = new Map<string, Entry | null>();
      const conflicts: string[] = [];
      for (const session of openSessions) {
        // The poster's own listing on *this* session is what is being
        // claimed — it is replaced by the team entry, so it does not count
        // as a conflict (plan design notes: "treat their own solo entry as
        // free"). Every other session must be genuinely free.
        const entry = session.id === input.sessionId ? posterEntry : await readEntry(tx, session.id, poster.id);
        if (session.id !== input.sessionId && !isFree(entry)) {
          conflicts.push(session.date);
        }
        existingEntries.set(session.id, session.id === input.sessionId ? null : entry);
      }
      if (conflicts.length > 0) {
        throw new HttpsError('failed-precondition', `That member is already committed on: ${conflicts.join(', ')}.`);
      }

      const baseline = await loadTeamEntries(tx, team.id);
      const now = new Date().toISOString();
      const updatedTeam: Team = {
        ...team,
        members: [...team.members, { ref: memberRef(poster), joinedAt: now }],
        updatedAt: now,
      };
      updatedTeam.status = refreshTeamStatus(updatedTeam, series);

      const written = writeTeamEntries(tx, updatedTeam, openSessions, existingEntries, poster.id, actor.memberId, actor.onBehalfBy);
      tx.set(db.doc(paths.team(updatedTeam.id)), updatedTeam);
      assertTeamValid(updatedTeam, series, mergeEntries(baseline, written));

      return { kind: 'team' as const, entries: written, team: updatedTeam, poster };
    }

    // ---- Pairs / Individual (unchanged) ----
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

    return { kind: 'pair' as const, entries: [entryA, entryB], warning, poster };
  });

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'claim_looking_for_partner_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: result.kind === 'team' ? paths.team(result.team.id) : paths.entry(entryId(input.sessionId, actor.memberId)),
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin claimed a partner listing for you',
      result.kind === 'team'
        ? `An admin added ${result.poster.firstName} ${result.poster.lastName} to your team on your behalf.`
        : `An admin paired you with ${result.poster.firstName} ${result.poster.lastName} on your behalf.`,
      { sessionId: input.sessionId },
    );
  }
  await createNotification(
    result.poster.id,
    'claimed',
    result.kind === 'team' ? 'A captain claimed your listing' : 'Someone claimed your listing',
    result.kind === 'team' ? `${actorName} added you to their team.` : `${actorName} will play with you.`,
    { sessionId: input.sessionId, year: String(input.year) },
  );

  return {
    entries: result.entries,
    team: result.kind === 'team' ? result.team : undefined,
    repeatPartnerWarning: result.kind === 'pair' ? result.warning : undefined,
  };
}

export const claimLookingForPartner = onCall(callableOptions, claimLookingForPartnerHandler);

/* ------------------------------------ cancelEntry ----------------------------- */

export async function cancelEntryHandler(req: CallableRequest<CancelEntryInput>): Promise<CancelEntryResult> {
  const input = parseInput(CancelEntryInputSchema, req.data);
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

    return cancelEntryInTx(tx, entry, { actorMemberId: actor.memberId, actorName });
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

  if (result.cancelledVisitorId) {
    const visitorSnap = await db.doc(paths.visitor(result.cancelledVisitorId)).get();
    const visitor = visitorSnap.data() as Visitor | undefined;
    if (visitor?.courtesyEmails && visitor.email) {
      const content = visitorCancelledEmail({
        sponsorName: actorName,
        sponsorPhone: actor.member.phone || undefined,
        date: result.ownEntry.date,
      });
      await getEmailProvider().send({ to: visitor.email, subject: content.subject, text: content.text, html: content.html });
    }
  }

  return { entry: result.ownEntry, partnerEntry: result.partnerEntry };
}

export const cancelEntry = onCall(callableOptions, cancelEntryHandler);

/**
 * Team callables (plan §9.2, §12A): `createTeam`, `inviteToTeam`,
 * `addVisitorToTeam`/`removeVisitorFromTeam`, `leaveTeam`, `removeFromTeam`,
 * `transferCaptaincy`, `disbandTeam`, `addTeamSessionSubstitute`/
 * `clearTeamSessionSubstitute`. The team-scope branch of `respondToInvite`
 * lives in `entries/invites.ts`; the Teams branches of `setSoloStatus` /
 * `claimLookingForPartner` live in `entries/entries.ts`. Every mutation here
 * re-validates `validateTeamGroup` (I9) before commit via `teams/lib.ts`'s
 * `assertTeamValid`.
 */
import { randomUUID } from 'node:crypto';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  AddTeamSessionSubstituteInputSchema,
  AddVisitorToTeamInputSchema,
  ClearTeamSessionSubstituteInputSchema,
  CreateTeamInputSchema,
  DisbandTeamInputSchema,
  InviteToTeamInputSchema,
  LeaveTeamInputSchema,
  RemoveFromTeamInputSchema,
  RemoveVisitorFromTeamInputSchema,
  TransferCaptaincyInputSchema,
  paths,
  sessionCutoff,
  type AddTeamSessionSubstituteInput,
  type AddTeamSessionSubstituteResult,
  type AddVisitorToTeamInput,
  type AddVisitorToTeamResult,
  type ClearTeamSessionSubstituteInput,
  type ClearTeamSessionSubstituteResult,
  type CreateTeamInput,
  type CreateTeamResult,
  type DisbandTeamInput,
  type DisbandTeamResult,
  type Entry,
  type Invite,
  type InviteToTeamInput,
  type InviteToTeamResult,
  type LeaveTeamInput,
  type LeaveTeamResult,
  type Member,
  type PartnerRef,
  type RemoveFromTeamInput,
  type RemoveFromTeamResult,
  type RemoveVisitorFromTeamInput,
  type RemoveVisitorFromTeamResult,
  type Team,
  type TransferCaptaincyInput,
  type TransferCaptaincyResult,
  type Visitor,
} from '@obc/shared';
import { db } from '../lib/admin.js';
import { audit } from '../lib/audit.js';
import { callableOptions } from '../lib/callable.js';
import { requireMember, resolveActingMember } from '../lib/context.js';
import { parseInput } from '../lib/parseInput.js';
import { assertRateLimit } from '../lib/rateLimit.js';
import { createNotification } from '../notifications/create.js';
import { assertForceAllowed, assertSessionOpen, entryId, isFree, loadSession, memberRef, readEntry } from '../entries/lib.js';
import {
  assertCaptain,
  assertNotDisbanded,
  assertTeamValid,
  assertTeamsSeries,
  cancelTeamEntries,
  loadSeries,
  loadTeam,
  loadTeamEntries,
  memberTeamInSeries,
  mergeEntries,
  refreshTeamStatus,
  seriesSessions,
  teamId as buildTeamId,
  unlockedSessions,
  writeTeamEntries,
} from './lib.js';

const INVITE_SEND_LIMIT = 30;
const INVITE_SEND_WINDOW_SEC = 24 * 3600;
const INVITE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

type MemberTeamEntry = { ref: Extract<PartnerRef, { kind: 'member' }>; joinedAt: string };
function memberRefsOf(team: Team): MemberTeamEntry[] {
  return team.members.filter((m): m is MemberTeamEntry => m.ref.kind === 'member');
}

/* ---------------------------------- createTeam -------------------------------- */

export async function createTeamHandler(req: CallableRequest<CreateTeamInput>): Promise<CreateTeamResult> {
  const input = parseInput(CreateTeamInputSchema, req.data);
  const caller = await requireMember(req);
  assertForceAllowed(caller, input.force);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);

  const result = await db.runTransaction(async (tx) => {
    const { series, weekday, programme } = await loadSeries(tx, input.year, input.seriesId);
    assertTeamsSeries(series);

    const existingTeamInSeries = await memberTeamInSeries(tx, series.id, actor.memberId);
    if (existingTeamInSeries) {
      throw new HttpsError('failed-precondition', 'You are already on a team for this series.');
    }

    const sessions = await seriesSessions(tx, input.year, series);
    const openSessions = unlockedSessions(sessions, weekday, programme, { force: input.force });
    if (openSessions.length === 0) {
      throw new HttpsError('failed-precondition', 'Every session in this series has already started.');
    }

    const existingEntries = new Map<string, Entry | null>();
    for (const session of openSessions) {
      existingEntries.set(session.id, await readEntry(tx, session.id, actor.memberId));
    }
    const conflicts = openSessions.filter((s) => !isFree(existingEntries.get(s.id) ?? null));
    if (conflicts.length > 0) {
      throw new HttpsError('failed-precondition', `Already committed on: ${conflicts.map((s) => s.date).join(', ')}.`);
    }

    const id = buildTeamId(series.id, actor.memberId);
    const now = new Date().toISOString();
    const team: Team = {
      id,
      year: input.year,
      seriesId: series.id,
      name: input.name?.trim() || `${actor.member.lastName} team`,
      captainMemberId: actor.memberId,
      cohort: actor.member.cohort,
      members: [{ ref: memberRef(actor.member), joinedAt: now }],
      status: 'forming',
      createdAt: now,
      updatedAt: now,
    };
    team.status = refreshTeamStatus(team, series);

    const entries = writeTeamEntries(
      tx,
      team,
      openSessions,
      existingEntries,
      actor.memberId,
      actor.memberId,
      actor.onBehalfBy,
    );
    tx.set(db.doc(paths.team(id)), team);
    assertTeamValid(team, series, entries);
    return { team, entries };
  });

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'create_team_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: paths.team(result.team.id),
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin started a team for you',
      `An admin started "${result.team.name}" on your behalf.`,
      { teamId: result.team.id },
    );
  }

  return result;
}

export const createTeam = onCall(callableOptions, createTeamHandler);

/* --------------------------------- inviteToTeam -------------------------------- */

export async function inviteToTeamHandler(req: CallableRequest<InviteToTeamInput>): Promise<InviteToTeamResult> {
  const input = parseInput(InviteToTeamInputSchema, req.data);
  const caller = await requireMember(req);
  assertForceAllowed(caller, input.force);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);

  if (input.toMemberId === actor.memberId) {
    throw new HttpsError('invalid-argument', 'You cannot invite yourself.');
  }
  const toSnap = await db.doc(paths.member(input.toMemberId)).get();
  const toMember = toSnap.data() as Member | undefined;
  if (!toMember || !toMember.active) {
    throw new HttpsError('failed-precondition', 'That member is not available to invite.');
  }
  // Review-cohort partition (plan §8.1, decided 2026-09-05).
  if (toMember.cohort !== actor.member.cohort) {
    throw new HttpsError('failed-precondition', 'That member is not available to invite.');
  }

  await assertRateLimit('invites:send', actor.memberId, INVITE_SEND_LIMIT, INVITE_SEND_WINDOW_SEC);

  const invite = await db.runTransaction(async (tx) => {
    const team = await loadTeam(tx, input.teamId);
    assertCaptain(team, actor.memberId);
    assertNotDisbanded(team);

    const { series, weekday, programme } = await loadSeries(tx, team.year, team.seriesId);
    if (team.members.length >= series.teamMax) {
      throw new HttpsError('failed-precondition', 'This team is full.');
    }
    if (memberRefsOf(team).some((m) => m.ref.memberId === input.toMemberId)) {
      throw new HttpsError('failed-precondition', 'That member is already on this team.');
    }
    const elsewhere = await memberTeamInSeries(tx, series.id, input.toMemberId);
    if (elsewhere) {
      throw new HttpsError('failed-precondition', 'That member is already on a team for this series.');
    }

    const sessions = await seriesSessions(tx, team.year, series);
    const openSessions = unlockedSessions(sessions, weekday, programme, { force: input.force });
    if (openSessions.length === 0) {
      throw new HttpsError('failed-precondition', 'Every session in this series has already started.');
    }
    const conflicts: string[] = [];
    for (const session of openSessions) {
      const entry = await readEntry(tx, session.id, input.toMemberId);
      if (!isFree(entry)) conflicts.push(session.date);
    }
    if (conflicts.length > 0) {
      throw new HttpsError('failed-precondition', `That member is already committed on: ${conflicts.join(', ')}.`);
    }

    const pendingSnap = await tx.get(
      db
        .collection(paths.invites())
        .where('teamId', '==', team.id)
        .where('toMemberId', '==', input.toMemberId)
        .where('status', '==', 'pending'),
    );
    if (!pendingSnap.empty) {
      throw new HttpsError('failed-precondition', 'That member already has a pending invite to this team.');
    }

    const inviteId = randomUUID();
    const now = new Date().toISOString();
    const first = openSessions[0]!;
    const expiresAt = new Date(
      Math.min(Date.now() + INVITE_MAX_AGE_MS, sessionCutoff(first.date, weekday.startTime).getTime()),
    ).toISOString();

    const doc: Invite = {
      id: inviteId,
      scope: 'team',
      kind: 'join',
      year: team.year,
      sessionIds: openSessions.map((s) => s.id),
      seriesId: team.seriesId,
      teamId: team.id,
      fromMemberId: team.captainMemberId,
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
      action: 'invite_to_team_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: paths.invite(invite.id),
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin sent a team invite for you',
      `An admin invited ${toMember.firstName} ${toMember.lastName} to your team on your behalf.`,
      { inviteId: invite.id },
    );
  }
  await createNotification(
    invite.toMemberId,
    'team_invite_received',
    'You have a team invite',
    `${actor.member.firstName} ${actor.member.lastName} invited you to join their team.`,
    { inviteId: invite.id, teamId: invite.teamId ?? '' },
  );

  return { invite };
}

export const inviteToTeam = onCall(callableOptions, inviteToTeamHandler);

/* ----------------------------- addVisitorToTeam -------------------------------- */

export async function addVisitorToTeamHandler(
  req: CallableRequest<AddVisitorToTeamInput>,
): Promise<AddVisitorToTeamResult> {
  const input = parseInput(AddVisitorToTeamInputSchema, req.data);
  const caller = await requireMember(req);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);

  const team = await db.runTransaction(async (tx) => {
    const team = await loadTeam(tx, input.teamId);
    assertCaptain(team, actor.memberId);
    assertNotDisbanded(team);
    const { series } = await loadSeries(tx, team.year, team.seriesId);
    if (team.members.length >= series.teamMax) {
      throw new HttpsError('failed-precondition', 'This team is full.');
    }
    const visitorSnap = await tx.get(db.doc(paths.visitor(input.visitorId)));
    const visitor = visitorSnap.data() as Visitor | undefined;
    if (!visitor) throw new HttpsError('not-found', 'Visitor not found.');
    if (visitor.createdByMemberId !== actor.memberId && !caller.isAdmin) {
      throw new HttpsError('permission-denied', 'You may only add a visitor you sponsor.');
    }
    if (team.members.some((m) => m.ref.kind === 'visitor' && m.ref.visitorId === input.visitorId)) {
      throw new HttpsError('failed-precondition', 'That visitor is already on this team.');
    }
    const baseline = await loadTeamEntries(tx, team.id);

    const now = new Date().toISOString();
    const updated: Team = {
      ...team,
      members: [
        ...team.members,
        { ref: { kind: 'visitor', visitorId: visitor.id, displayName: visitor.displayName }, joinedAt: now },
      ],
      updatedAt: now,
    };
    updated.status = refreshTeamStatus(updated, series);
    tx.set(db.doc(paths.team(team.id)), updated);
    tx.set(db.doc(paths.visitor(visitor.id)), { ...visitor, lastUsedAt: now });
    assertTeamValid(updated, series, baseline);
    return updated;
  });

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'add_visitor_to_team_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: paths.team(team.id),
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin added a visitor to your team',
      'An admin added a visitor to your team on your behalf.',
      { teamId: team.id },
    );
  }

  return { team };
}

export const addVisitorToTeam = onCall(callableOptions, addVisitorToTeamHandler);

/* --------------------------- removeVisitorFromTeam ------------------------------ */

export async function removeVisitorFromTeamHandler(
  req: CallableRequest<RemoveVisitorFromTeamInput>,
): Promise<RemoveVisitorFromTeamResult> {
  const input = parseInput(RemoveVisitorFromTeamInputSchema, req.data);
  const caller = await requireMember(req);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);

  const team = await db.runTransaction(async (tx) => {
    const team = await loadTeam(tx, input.teamId);
    assertCaptain(team, actor.memberId);
    assertNotDisbanded(team);
    const { series } = await loadSeries(tx, team.year, team.seriesId);
    const found = team.members.some((m) => m.ref.kind === 'visitor' && m.ref.visitorId === input.visitorId);
    if (!found) throw new HttpsError('not-found', 'That visitor is not on this team.');
    const baseline = await loadTeamEntries(tx, team.id);

    const now = new Date().toISOString();
    const updated: Team = {
      ...team,
      members: team.members.filter((m) => !(m.ref.kind === 'visitor' && m.ref.visitorId === input.visitorId)),
      updatedAt: now,
    };
    updated.status = refreshTeamStatus(updated, series);
    tx.set(db.doc(paths.team(team.id)), updated);
    assertTeamValid(updated, series, baseline);
    return updated;
  });

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'remove_visitor_from_team_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: paths.team(team.id),
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin removed a visitor from your team',
      'An admin removed a visitor from your team on your behalf.',
      { teamId: team.id },
    );
  }

  return { team };
}

export const removeVisitorFromTeam = onCall(callableOptions, removeVisitorFromTeamHandler);

/* ------------------------------------ leaveTeam -------------------------------- */

export async function leaveTeamHandler(req: CallableRequest<LeaveTeamInput>): Promise<LeaveTeamResult> {
  const input = parseInput(LeaveTeamInputSchema, req.data);
  const caller = await requireMember(req);
  assertForceAllowed(caller, input.force);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);
  const actorName = `${actor.member.firstName} ${actor.member.lastName}`;

  const result = await db.runTransaction(async (tx) => {
    const team = await loadTeam(tx, input.teamId);
    assertNotDisbanded(team);
    const isMember = team.members.some((m) => m.ref.kind === 'member' && m.ref.memberId === actor.memberId);
    if (!isMember) {
      throw new HttpsError('permission-denied', 'You are not a member of this team.');
    }
    if (team.captainMemberId === actor.memberId) {
      throw new HttpsError('failed-precondition', 'Transfer the captaincy or disband first.');
    }

    const { series, weekday, programme } = await loadSeries(tx, team.year, team.seriesId);
    const sessions = await seriesSessions(tx, team.year, series);
    const openSessions = unlockedSessions(sessions, weekday, programme, { force: input.force });
    const existingEntries = new Map<string, Entry | null>();
    for (const session of openSessions) {
      existingEntries.set(session.id, await readEntry(tx, session.id, actor.memberId));
    }
    const baseline = await loadTeamEntries(tx, team.id);

    const now = new Date().toISOString();
    const updated: Team = {
      ...team,
      members: team.members.filter((m) => !(m.ref.kind === 'member' && m.ref.memberId === actor.memberId)),
      updatedAt: now,
    };
    updated.status = refreshTeamStatus(updated, series);
    const cancelled = cancelTeamEntries(tx, actor.memberId, openSessions, existingEntries);
    tx.set(db.doc(paths.team(team.id)), updated);
    assertTeamValid(updated, series, mergeEntries(baseline, cancelled));
    return { team: updated, captainMemberId: team.captainMemberId };
  });

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'leave_team_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: paths.team(result.team.id),
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin removed you from a team',
      `An admin took you off "${result.team.name}" on your behalf.`,
      { teamId: result.team.id },
    );
  }
  await createNotification(
    result.captainMemberId,
    'team_member_left',
    'A team member has left',
    `${actorName} has left "${result.team.name}".`,
    { teamId: result.team.id },
  );

  return { team: result.team };
}

export const leaveTeam = onCall(callableOptions, leaveTeamHandler);

/* --------------------------------- removeFromTeam ------------------------------- */

export async function removeFromTeamHandler(req: CallableRequest<RemoveFromTeamInput>): Promise<RemoveFromTeamResult> {
  const input = parseInput(RemoveFromTeamInputSchema, req.data);
  const caller = await requireMember(req);
  assertForceAllowed(caller, input.force);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);
  const ref = input.ref;

  const result = await db.runTransaction(async (tx) => {
    const team = await loadTeam(tx, input.teamId);
    assertCaptain(team, actor.memberId);
    assertNotDisbanded(team);

    if (ref.kind === 'member' && ref.memberId === team.captainMemberId) {
      throw new HttpsError('invalid-argument', 'The captain cannot be removed — transfer captaincy or disband instead.');
    }
    const found = team.members.some((m) =>
      ref.kind === 'member' ? m.ref.kind === 'member' && m.ref.memberId === ref.memberId : m.ref.kind === 'visitor' && m.ref.visitorId === ref.visitorId,
    );
    if (!found) {
      throw new HttpsError('not-found', 'That member or visitor is not on this team.');
    }

    const { series, weekday, programme } = await loadSeries(tx, team.year, team.seriesId);
    let openSessions: Awaited<ReturnType<typeof seriesSessions>> = [];
    const existingEntries = new Map<string, Entry | null>();
    if (ref.kind === 'member') {
      const sessions = await seriesSessions(tx, team.year, series);
      openSessions = unlockedSessions(sessions, weekday, programme, { force: input.force });
      for (const session of openSessions) {
        existingEntries.set(session.id, await readEntry(tx, session.id, ref.memberId));
      }
    }
    const baseline = await loadTeamEntries(tx, team.id);

    const now = new Date().toISOString();
    const updated: Team = {
      ...team,
      members: team.members.filter((m) =>
        ref.kind === 'member' ? !(m.ref.kind === 'member' && m.ref.memberId === ref.memberId) : !(m.ref.kind === 'visitor' && m.ref.visitorId === ref.visitorId),
      ),
      updatedAt: now,
    };
    updated.status = refreshTeamStatus(updated, series);

    const cancelled = ref.kind === 'member' ? cancelTeamEntries(tx, ref.memberId, openSessions, existingEntries) : [];
    tx.set(db.doc(paths.team(team.id)), updated);
    assertTeamValid(updated, series, mergeEntries(baseline, cancelled));
    return { team: updated };
  });

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'remove_from_team_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: paths.team(result.team.id),
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin removed someone from your team',
      'An admin removed a member or visitor from your team on your behalf.',
      { teamId: result.team.id },
    );
  }
  if (ref.kind === 'member') {
    await createNotification(
      ref.memberId,
      'team_removed',
      'You were removed from a team',
      `You were removed from "${result.team.name}".`,
      { teamId: result.team.id },
    );
  }

  return { team: result.team };
}

export const removeFromTeam = onCall(callableOptions, removeFromTeamHandler);

/* ------------------------------- transferCaptaincy ------------------------------ */

export async function transferCaptaincyHandler(
  req: CallableRequest<TransferCaptaincyInput>,
): Promise<TransferCaptaincyResult> {
  const input = parseInput(TransferCaptaincyInputSchema, req.data);
  const caller = await requireMember(req);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);

  if (input.toMemberId === actor.memberId) {
    throw new HttpsError('invalid-argument', 'You are already the captain.');
  }

  const invite = await db.runTransaction(async (tx) => {
    const team = await loadTeam(tx, input.teamId);
    assertCaptain(team, actor.memberId);
    assertNotDisbanded(team);

    const isMember = team.members.some((m) => m.ref.kind === 'member' && m.ref.memberId === input.toMemberId);
    if (!isMember) {
      throw new HttpsError('failed-precondition', 'That member is not on this team.');
    }
    // Review-cohort partition (plan §8.1, decided 2026-09-05): defence in
    // depth — a same-team member is already guaranteed to share the team's
    // (and so the captain's) cohort, but check explicitly rather than trust
    // that invariant transitively.
    const toSnap = await tx.get(db.doc(paths.member(input.toMemberId)));
    const toMember = toSnap.data() as Member | undefined;
    if (!toMember || toMember.cohort !== actor.member.cohort) {
      throw new HttpsError('failed-precondition', 'That member is not available.');
    }

    const pendingSnap = await tx.get(
      db
        .collection(paths.invites())
        .where('teamId', '==', team.id)
        .where('toMemberId', '==', input.toMemberId)
        .where('status', '==', 'pending'),
    );
    const hasDuplicate = pendingSnap.docs.some((d) => (d.data() as Invite).kind === 'captaincy');
    if (hasDuplicate) {
      throw new HttpsError('failed-precondition', 'That member already has a pending captaincy offer for this team.');
    }

    const inviteId = randomUUID();
    const now = new Date().toISOString();
    const doc: Invite = {
      id: inviteId,
      scope: 'team',
      kind: 'captaincy',
      year: team.year,
      sessionIds: [],
      seriesId: team.seriesId,
      teamId: team.id,
      fromMemberId: team.captainMemberId,
      toMemberId: input.toMemberId,
      status: 'pending',
      createdBy: caller.uid,
      onBehalfBy: actor.onBehalfBy,
      expiresAt: new Date(Date.now() + INVITE_MAX_AGE_MS).toISOString(),
      createdAt: now,
      updatedAt: now,
    };
    tx.set(db.doc(paths.invite(inviteId)), doc);
    return doc;
  });

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'transfer_captaincy_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: paths.invite(invite.id),
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin offered your captaincy to someone else',
      'An admin offered the captaincy of your team to another member, on your behalf.',
      { inviteId: invite.id },
    );
  }
  await createNotification(
    invite.toMemberId,
    'team_captaincy_offered',
    'You have been offered a team captaincy',
    `${actor.member.firstName} ${actor.member.lastName} wants to hand you the captaincy of their team.`,
    { inviteId: invite.id, teamId: invite.teamId ?? '' },
  );

  return { invite };
}

export const transferCaptaincy = onCall(callableOptions, transferCaptaincyHandler);

/* ----------------------------------- disbandTeam --------------------------------- */

export async function disbandTeamHandler(req: CallableRequest<DisbandTeamInput>): Promise<DisbandTeamResult> {
  const input = parseInput(DisbandTeamInputSchema, req.data);
  const caller = await requireMember(req);
  assertForceAllowed(caller, input.force);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);

  const result = await db.runTransaction(async (tx) => {
    const team = await loadTeam(tx, input.teamId);
    assertCaptain(team, actor.memberId);
    assertNotDisbanded(team);

    const { series, weekday, programme } = await loadSeries(tx, team.year, team.seriesId);
    const sessions = await seriesSessions(tx, team.year, series);
    const openSessions = unlockedSessions(sessions, weekday, programme, { force: input.force });

    const memberRefs = memberRefsOf(team);
    const existingEntriesByMember = new Map<string, Map<string, Entry | null>>();
    for (const m of memberRefs) {
      const map = new Map<string, Entry | null>();
      for (const session of openSessions) {
        map.set(session.id, await readEntry(tx, session.id, m.ref.memberId));
      }
      existingEntriesByMember.set(m.ref.memberId, map);
    }
    const baseline = await loadTeamEntries(tx, team.id);
    const pendingInvitesSnap = await tx.get(
      db.collection(paths.invites()).where('teamId', '==', team.id).where('status', '==', 'pending'),
    );

    const now = new Date().toISOString();
    const updatedTeam: Team = { ...team, status: 'disbanded', updatedAt: now };

    let cancelled: Entry[] = [];
    for (const m of memberRefs) {
      cancelled = cancelled.concat(
        cancelTeamEntries(tx, m.ref.memberId, openSessions, existingEntriesByMember.get(m.ref.memberId)!),
      );
    }
    tx.set(db.doc(paths.team(team.id)), updatedTeam);
    for (const doc of pendingInvitesSnap.docs) {
      const inv = doc.data() as Invite;
      tx.set(doc.ref, { ...inv, status: 'expired', updatedAt: now });
    }

    assertTeamValid(updatedTeam, series, mergeEntries(baseline, cancelled));
    return { team: updatedTeam, memberIds: memberRefs.map((m) => m.ref.memberId) };
  });

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'disband_team_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: paths.team(result.team.id),
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin disbanded your team',
      `An admin disbanded "${result.team.name}" on your behalf.`,
      { teamId: result.team.id },
    );
  }
  for (const memberId of result.memberIds) {
    await createNotification(
      memberId,
      'team_disbanded',
      'Your team has been disbanded',
      `"${result.team.name}" has been disbanded.`,
      { teamId: result.team.id },
    );
  }

  return { team: result.team };
}

export const disbandTeam = onCall(callableOptions, disbandTeamHandler);

/* --------------------------- addTeamSessionSubstitute ---------------------------- */

export async function addTeamSessionSubstituteHandler(
  req: CallableRequest<AddTeamSessionSubstituteInput>,
): Promise<AddTeamSessionSubstituteResult> {
  const input = parseInput(AddTeamSessionSubstituteInputSchema, req.data);
  const caller = await requireMember(req);
  assertForceAllowed(caller, input.force);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);

  const result = await db.runTransaction(async (tx) => {
    const team = await loadTeam(tx, input.teamId);
    assertCaptain(team, actor.memberId);
    assertNotDisbanded(team);

    const loaded = await loadSession(tx, team.year, input.sessionId);
    if (!loaded.series || loaded.series.id !== team.seriesId) {
      throw new HttpsError('failed-precondition', "That session is not part of this team's series.");
    }
    assertSessionOpen(loaded.session, loaded.weekday, loaded.programme, { force: input.force, allowTeamsSession: true });

    const memberRefs = memberRefsOf(team);
    let someoneAbsent = false;
    for (const m of memberRefs) {
      const entry = await readEntry(tx, input.sessionId, m.ref.memberId);
      if (entry?.status === 'cancelled') someoneAbsent = true;
    }
    if (!someoneAbsent) {
      throw new HttpsError('failed-precondition', 'No rostered team member is absent for this session.');
    }

    const baseline = await loadTeamEntries(tx, team.id);
    const now = new Date().toISOString();

    if (input.ref.kind === 'member') {
      const subMemberId = input.ref.memberId;
      if (memberRefs.some((m) => m.ref.memberId === subMemberId)) {
        throw new HttpsError('failed-precondition', 'That member is already on the team roster.');
      }
      const subSnap = await tx.get(db.doc(paths.member(subMemberId)));
      const subMember = subSnap.data() as Member | undefined;
      if (!subMember || !subMember.active) {
        throw new HttpsError('failed-precondition', 'That member is not available.');
      }
      // Review-cohort partition (plan §8.1, decided 2026-09-05): a team
      // session substitute must share the team's cohort.
      if (subMember.cohort !== team.cohort) {
        throw new HttpsError('failed-precondition', 'That member is not available.');
      }
      const existing = await readEntry(tx, input.sessionId, subMemberId);
      if (!isFree(existing)) {
        throw new HttpsError('failed-precondition', 'That member already has an entry for this session.');
      }

      const entry: Entry = {
        id: entryId(input.sessionId, subMemberId),
        sessionId: input.sessionId,
        date: loaded.session.date,
        weekday: loaded.session.weekday,
        seriesId: loaded.session.seriesId,
        memberId: subMemberId,
        cohort: subMember.cohort,
        status: 'confirmed',
        partner: null,
        pairingId: null,
        teamId: team.id,
        teamSessionOnly: true,
        substitute: null,
        partnerSubstitute: null,
        isSubstituteFor: null,
        createdBy: actor.memberId,
        onBehalfBy: actor.onBehalfBy,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      tx.set(db.doc(paths.entry(entry.id)), entry);
      assertTeamValid(team, loaded.series, mergeEntries(baseline, [entry]));
      return { entry, team, subMemberId, date: loaded.session.date };
    }

    const visitorSnap = await tx.get(db.doc(paths.visitor(input.ref.visitorId)));
    const visitor = visitorSnap.data() as Visitor | undefined;
    if (!visitor) throw new HttpsError('not-found', 'Visitor not found.');
    if (visitor.createdByMemberId !== actor.memberId && !caller.isAdmin) {
      throw new HttpsError('permission-denied', 'You may only bring a visitor you sponsor.');
    }
    const already = team.sessionVisitors?.[input.sessionId] ?? [];
    if (already.some((r) => r.kind === 'visitor' && r.visitorId === visitor.id)) {
      throw new HttpsError('failed-precondition', 'That visitor is already standing in for this session.');
    }
    const updatedTeam: Team = {
      ...team,
      sessionVisitors: {
        ...team.sessionVisitors,
        [input.sessionId]: [...already, { kind: 'visitor', visitorId: visitor.id, displayName: visitor.displayName }],
      },
      updatedAt: now,
    };
    tx.set(db.doc(paths.team(team.id)), updatedTeam);
    assertTeamValid(updatedTeam, loaded.series, baseline);
    return { entry: undefined, team: updatedTeam, subMemberId: undefined, date: loaded.session.date };
  });

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'add_team_session_substitute_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: paths.team(result.team.id),
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin arranged a team substitute for you',
      'An admin arranged a session substitute for your team on your behalf.',
      { teamId: result.team.id, sessionId: input.sessionId },
    );
  }
  if (result.subMemberId) {
    await createNotification(
      result.subMemberId,
      'substitute_arranged',
      "You're standing in for a team",
      `You're standing in for "${result.team.name}" on ${result.date}.`,
      { teamId: result.team.id, sessionId: input.sessionId },
    );
  }

  return { entry: result.entry, team: result.team };
}

export const addTeamSessionSubstitute = onCall(callableOptions, addTeamSessionSubstituteHandler);

/* --------------------------- clearTeamSessionSubstitute -------------------------- */

export async function clearTeamSessionSubstituteHandler(
  req: CallableRequest<ClearTeamSessionSubstituteInput>,
): Promise<ClearTeamSessionSubstituteResult> {
  const input = parseInput(ClearTeamSessionSubstituteInputSchema, req.data);
  const caller = await requireMember(req);
  assertForceAllowed(caller, input.force);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);

  const result = await db.runTransaction(async (tx) => {
    const team = await loadTeam(tx, input.teamId);
    assertCaptain(team, actor.memberId);
    assertNotDisbanded(team);

    const loaded = await loadSession(tx, team.year, input.sessionId);
    if (!loaded.series || loaded.series.id !== team.seriesId) {
      throw new HttpsError('failed-precondition', "That session is not part of this team's series.");
    }

    const baseline = await loadTeamEntries(tx, team.id);
    const now = new Date().toISOString();

    if (input.ref.kind === 'member') {
      const subMemberId = input.ref.memberId;
      const existing = await readEntry(tx, input.sessionId, subMemberId);
      if (!existing || existing.status === 'cancelled' || !existing.teamSessionOnly || existing.teamId !== team.id) {
        throw new HttpsError('failed-precondition', 'No substitute arrangement found for that member on this session.');
      }
      const cancelled: Entry = { ...existing, status: 'cancelled', updatedAt: now };
      tx.set(db.doc(paths.entry(cancelled.id)), cancelled);
      assertTeamValid(team, loaded.series, mergeEntries(baseline, [cancelled]));
      return { entry: cancelled, team, subMemberId, date: loaded.session.date };
    }

    const visitorId = input.ref.visitorId;
    const already = team.sessionVisitors?.[input.sessionId] ?? [];
    if (!already.some((r) => r.kind === 'visitor' && r.visitorId === visitorId)) {
      throw new HttpsError('failed-precondition', 'No substitute arrangement found for that visitor on this session.');
    }
    const remaining = already.filter((r) => !(r.kind === 'visitor' && r.visitorId === visitorId));
    const nextSessionVisitors = { ...team.sessionVisitors };
    if (remaining.length > 0) nextSessionVisitors[input.sessionId] = remaining;
    else delete nextSessionVisitors[input.sessionId];
    const updatedTeam: Team = { ...team, sessionVisitors: nextSessionVisitors, updatedAt: now };
    tx.set(db.doc(paths.team(team.id)), updatedTeam);
    assertTeamValid(updatedTeam, loaded.series, baseline);
    return { entry: undefined, team: updatedTeam, subMemberId: undefined, date: loaded.session.date };
  });

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'clear_team_session_substitute_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: paths.team(result.team.id),
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin cleared a team substitute for you',
      'An admin cleared a session substitute for your team on your behalf.',
      { teamId: result.team.id, sessionId: input.sessionId },
    );
  }
  if (result.subMemberId) {
    await createNotification(
      result.subMemberId,
      'substitute_cleared',
      'Your stand-in arrangement was cleared',
      `You are no longer standing in for "${result.team.name}" on ${result.date}.`,
      { teamId: result.team.id, sessionId: input.sessionId },
    );
  }

  return { entry: result.entry, team: result.team };
}

export const clearTeamSessionSubstitute = onCall(callableOptions, clearTeamSessionSubstituteHandler);

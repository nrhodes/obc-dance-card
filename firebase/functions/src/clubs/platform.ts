/**
 * Platform administration (plan §21 B14.3, stage 2): `listClubs`,
 * `createClub`, `updateClub`, `setClubAdmin`. Every handler here requires a
 * platform administrator (`requirePlatformAdmin`) and records what it did in
 * `platformAuditLog`.
 *
 * A platform admin acts ON clubs — creating them, suspending them, deciding
 * who administers them. They hold no rights INSIDE a club beyond their own
 * membership of it. To administer a club's members or programme they appoint
 * themselves one of its admins here, which is itself audited; nothing else
 * gives a platform admin a view of a club's data.
 */
import { randomUUID } from 'node:crypto';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  CreateClubInputSchema,
  ListClubsInputSchema,
  NZ_TIME_ZONE,
  SetClubAdminInputSchema,
  UpdateClubInputSchema,
  clubPaths,
  paths,
  type Club,
  type ClubId,
  type ClubSummary,
  type CreateClubInput,
  type CreateClubResult,
  type ListClubsInput,
  type ListClubsResult,
  type Member,
  type PlatformAuditAction,
  type PlatformAuditEntry,
  type SetClubAdminInput,
  type SetClubAdminResult,
  type UpdateClubInput,
  type UpdateClubResult,
} from '@obc/shared';
import { FieldValue } from 'firebase-admin/firestore';
import { auth, db } from '../lib/admin.js';
import { audit } from '../lib/audit.js';
import { callableOptions } from '../lib/callable.js';
import { activeMembershipsOf, forgetClubCache, membershipsOf, userClubsWrite } from '../lib/clubs.js';
import { requirePlatformAdmin } from '../lib/context.js';
import { parseInput } from '../lib/parseInput.js';
import { provisionMember } from '../admin/provisionMember.js';
import { createNotification } from '../notifications/create.js';

async function platformAudit(entry: Omit<PlatformAuditEntry, 'id' | 'at'>): Promise<void> {
  const id = randomUUID();
  const doc: PlatformAuditEntry = { id, at: new Date().toISOString(), ...entry };
  await db.doc(paths.platformAuditLogEntry(id)).set(doc);
}

/* ----------------------------------- listClubs ---------------------------------- */

/**
 * Every club, with its active-member count and its admins — all the Platform
 * area needs. Served by a callable rather than by widening the rules, so a
 * platform admin's browser never gets a general read of any club's members.
 */
export async function listClubsHandler(req: CallableRequest<ListClubsInput>): Promise<ListClubsResult> {
  parseInput(ListClubsInputSchema, req.data ?? {});
  await requirePlatformAdmin(req);

  const clubsSnap = await db.collection(paths.clubs()).get();
  const clubs: ClubSummary[] = [];
  for (const clubDoc of clubsSnap.docs) {
    const club = clubDoc.data() as Club;
    const activeSnap = await db.collection(clubPaths(clubDoc.id).members()).where('active', '==', true).get();
    const admins = activeSnap.docs
      .map((d) => d.data() as Member)
      .filter((m) => m.role === 'admin')
      .map((m) => ({ memberId: m.id, name: `${m.firstName} ${m.lastName}`.trim(), ...(m.email ? { email: m.email } : {}) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    clubs.push({ club, activeMembers: activeSnap.size, admins });
  }
  clubs.sort((a, b) => a.club.name.localeCompare(b.club.name));
  return { clubs };
}

export const listClubs = onCall(callableOptions, listClubsHandler);

/* ----------------------------------- createClub --------------------------------- */

export async function createClubHandler(req: CallableRequest<CreateClubInput>): Promise<CreateClubResult> {
  const input = parseInput(CreateClubInputSchema, req.data);
  const caller = await requirePlatformAdmin(req);

  const now = new Date().toISOString();
  const club: Club = {
    id: input.clubId,
    name: input.name,
    shortName: input.shortName,
    timezone: NZ_TIME_ZONE,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  try {
    // `create` fails if the document exists: an id can never be reused or
    // silently taken over, even by two requests racing.
    await db.doc(paths.club(input.clubId)).create(club);
  } catch (err) {
    if ((err as { code?: number | string } | undefined)?.code === 6) {
      throw new HttpsError('failed-precondition', 'A club with that id already exists.');
    }
    throw err;
  }
  forgetClubCache();

  await platformAudit({ actorUid: caller.uid, action: 'club_created', clubId: input.clubId });
  return { club };
}

export const createClub = onCall(callableOptions, createClubHandler);

/* ----------------------------------- updateClub --------------------------------- */

export async function updateClubHandler(req: CallableRequest<UpdateClubInput>): Promise<UpdateClubResult> {
  const input = parseInput(UpdateClubInputSchema, req.data);
  const caller = await requirePlatformAdmin(req);

  const ref = db.doc(paths.club(input.clubId));
  const current = (await ref.get()).data() as Club | undefined;
  if (!current) throw new HttpsError('not-found', 'Unknown club.');

  const { patch } = input;
  const changes: Record<string, unknown> = {};
  const fields: string[] = [];
  if (patch.name !== undefined && patch.name !== current.name) {
    changes.name = patch.name;
    fields.push('name');
  }
  if (patch.shortName !== undefined && patch.shortName !== current.shortName) {
    changes.shortName = patch.shortName;
    fields.push('shortName');
  }
  if (patch.colour !== undefined && (patch.colour ?? undefined) !== current.colour) {
    changes.colour = patch.colour === null ? FieldValue.delete() : patch.colour;
    fields.push('colour');
  }
  const statusChanged = patch.status !== undefined && patch.status !== current.status;
  if (statusChanged) {
    if (patch.status === 'suspended') {
      // Signing in needs an active membership of an active club. Suspending
      // the only club the caller is active in would lock them out of the very
      // screen that could undo it.
      const others = (await activeMembershipsOf(caller.uid)).filter((m) => m.cp.clubId !== input.clubId);
      if (others.length === 0) {
        throw new HttpsError(
          'failed-precondition',
          'You are not an active member of any other club, so suspending this one would lock you out.',
        );
      }
    }
    changes.status = patch.status;
    fields.push('status');
  }

  if (fields.length === 0) return { club: current, changed: false };

  await ref.update({ ...changes, updatedAt: new Date().toISOString() });
  forgetClubCache();

  const action: PlatformAuditAction = !statusChanged
    ? 'club_updated'
    : patch.status === 'suspended'
      ? 'club_suspended'
      : 'club_reactivated';
  await platformAudit({ actorUid: caller.uid, action, clubId: input.clubId, detail: { fields } });

  return { club: (await ref.get()).data() as Club, changed: true };
}

export const updateClub = onCall(callableOptions, updateClubHandler);

/* ---------------------------------- setClubAdmin -------------------------------- */

async function activeAdminIds(clubId: ClubId): Promise<string[]> {
  const snap = await db
    .collection(clubPaths(clubId).members())
    .where('role', '==', 'admin')
    .where('active', '==', true)
    .get();
  return snap.docs.map((d) => d.id);
}

/**
 * Appoint or remove a club administrator by sign-in email.
 *
 * Appointing works whoever the person is: already a member of this club
 * (role changed, and reactivated if they were inactive); a member of another
 * club only (a membership here is created, named from the one they hold); or
 * nobody yet (an account and membership are created — names required).
 *
 * Removing leaves them an ordinary member and respects the last-admin guard:
 * a club is never left with no active admin.
 */
export async function setClubAdminHandler(req: CallableRequest<SetClubAdminInput>): Promise<SetClubAdminResult> {
  const input = parseInput(SetClubAdminInputSchema, req.data);
  const caller = await requirePlatformAdmin(req);

  const club = (await db.doc(paths.club(input.clubId)).get()).data() as Club | undefined;
  if (!club) throw new HttpsError('not-found', 'Unknown club.');
  const cp = clubPaths(input.clubId);

  const privateSnap = await db.collection(paths.userPrivates()).where('emailLower', '==', input.email).limit(1).get();
  const existingUid = privateSnap.empty ? undefined : privateSnap.docs[0]!.id;
  const existing = existingUid ? ((await db.doc(cp.member(existingUid)).get()).data() as Member | undefined) : undefined;

  /* ---- remove ---- */
  if (!input.admin) {
    if (!existingUid || !existing) throw new HttpsError('not-found', 'That person is not a member of this club.');
    if (existing.role !== 'admin') return { member: existing, membershipCreated: false };
    if (existing.active && (await activeAdminIds(input.clubId)).filter((id) => id !== existingUid).length === 0) {
      throw new HttpsError('failed-precondition', 'That would leave the club with no active admin. Appoint another first.');
    }
    const now = new Date().toISOString();
    await db.doc(cp.member(existingUid)).update({ role: 'member', updatedAt: now });
    await auth.revokeRefreshTokens(existingUid);
    await audit(cp, {
      actorMemberId: caller.uid,
      action: 'role_changed',
      targetMemberId: existingUid,
      entityRef: cp.member(existingUid),
      before: { role: 'admin' },
      after: { role: 'member' },
      detail: { by: 'platform-admin' },
    });
    await platformAudit({ actorUid: caller.uid, action: 'club_admin_removed', clubId: input.clubId, targetUid: existingUid });
    await createNotification(
      existingUid,
      'security',
      'Your admin access was removed',
      `You are no longer an administrator of ${club.name}.`,
      {},
    );
    return { member: (await db.doc(cp.member(existingUid)).get()).data() as Member, membershipCreated: false };
  }

  /* ---- appoint ---- */
  let uid: string;
  let membershipCreated = false;
  if (existingUid && existing) {
    uid = existingUid;
    if (existing.role === 'admin' && existing.active) return { member: existing, membershipCreated: false };
    const now = new Date().toISOString();
    await db.doc(cp.member(uid)).update({
      role: 'admin',
      active: true,
      deactivatedAt: FieldValue.delete(),
      updatedAt: now,
    });
    if (!existing.active) {
      const w = userClubsWrite(uid, input.clubId, true);
      await db.doc(w.path).set(w.data, { merge: true });
      await auth.updateUser(uid, { disabled: false });
    }
  } else {
    // No membership of this club yet. Take the name from a membership they
    // hold elsewhere, or from the request for someone entirely new.
    const elsewhere = existingUid ? (await membershipsOf(existingUid))[0]?.member : undefined;
    const firstName = input.firstName ?? elsewhere?.firstName;
    const lastName = input.lastName ?? elsewhere?.lastName;
    if (!firstName || !lastName) {
      throw new HttpsError(
        'invalid-argument',
        'Nobody has that email address yet. Give their first and last name to create them.',
      );
    }
    const result = await provisionMember(
      cp,
      // Deliberately no phone: this club has not been given one.
      { firstName, lastName, emailLower: input.email, phone: '', grade: elsewhere?.grade ?? 'Unknown', role: 'admin' },
      { dryRun: false },
    );
    if (!result.memberId) throw new HttpsError('internal', 'The admin could not be created.');
    uid = result.memberId;
    membershipCreated = true;
  }

  await auth.revokeRefreshTokens(uid);
  await audit(cp, {
    actorMemberId: caller.uid,
    action: 'role_changed',
    targetMemberId: uid,
    entityRef: cp.member(uid),
    before: { role: existing?.role ?? null },
    after: { role: 'admin' },
    detail: { by: 'platform-admin', membershipCreated },
  });
  await platformAudit({
    actorUid: caller.uid,
    action: 'club_admin_appointed',
    clubId: input.clubId,
    targetUid: uid,
    detail: { membershipCreated },
  });
  await createNotification(
    uid,
    'security',
    'You are now an admin',
    `You have been made an administrator of ${club.name}.`,
    {},
  );

  return { member: (await db.doc(cp.member(uid)).get()).data() as Member, membershipCreated };
}

export const setClubAdmin = onCall(callableOptions, setClubAdminHandler);

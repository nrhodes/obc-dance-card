/**
 * `setMemberRole`, `deactivateMember`, `reactivateMember`, `eraseMember`
 * (plan §8.1 "Privilege"/"Privacy law", §8.2 "Deactivation / role change",
 * §9.2, §16 Phase 6). Admin-only. Every mutation here re-reads inside a
 * transaction, enforces the last-admin guard, and — for deactivation — reuses
 * the exact `cancelEntry` cascade (`cancelEntryInTx`, `entries/lib.ts`) so a
 * deactivated member's future card is left in precisely the state a manual
 * `cancelEntry` on each of their entries would have produced.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  DEFAULT_NOTIFICATION_PREFS,
  DeactivateMemberInputSchema,
  EraseMemberInputSchema,
  ReactivateMemberInputSchema,
  SetMemberRoleInputSchema,
  paths,
  todayNZ,
  type DeactivateMemberInput,
  type DeactivateMemberResult,
  type Entry,
  type EraseMemberInput,
  type EraseMemberResult,
  type Invite,
  type Member,
  type MemberPrivate,
  type ReactivateMemberInput,
  type ReactivateMemberResult,
  type SetMemberRoleInput,
  type SetMemberRoleResult,
  type Team,
} from '@obc/shared';
import { auth, db } from '../lib/admin.js';
import { audit } from '../lib/audit.js';
import { BatchWriter } from '../lib/batchWriter.js';
import { callableOptions } from '../lib/callable.js';
import { requireAdmin } from '../lib/context.js';
import { logger } from '../lib/logger.js';
import { parseInput } from '../lib/parseInput.js';
import { cancelEntryInTx, type CancelEntryNotification } from '../entries/lib.js';
import { removeMemberFromAllTeams } from '../teams/lib.js';
import { createNotification } from '../notifications/create.js';

const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;

/* ---------------------------------- setMemberRole ------------------------------ */

export async function setMemberRoleHandler(req: CallableRequest<SetMemberRoleInput>): Promise<SetMemberRoleResult> {
  const input = parseInput(SetMemberRoleInputSchema, req.data);
  const caller = await requireAdmin(req);

  const memberRef = db.doc(paths.member(input.memberId));
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(memberRef);
    const member = snap.data() as Member | undefined;
    if (!member) throw new HttpsError('not-found', 'Member not found.');

    if (member.role === input.role) {
      return { before: member, after: member, changed: false };
    }

    // Last-admin guard (incl. self): never leave the club with zero active admins.
    if (member.role === 'admin' && input.role === 'member') {
      const adminsSnap = await tx.get(
        db.collection(paths.members()).where('role', '==', 'admin').where('active', '==', true),
      );
      const otherActiveAdmins = adminsSnap.docs.filter((d) => d.id !== input.memberId);
      if (otherActiveAdmins.length === 0) {
        throw new HttpsError('failed-precondition', 'You cannot demote the only active admin.');
      }
    }

    const now = new Date().toISOString();
    const updated: Member = { ...member, role: input.role, updatedAt: now };
    tx.set(memberRef, updated);
    return { before: member, after: updated, changed: true };
  });

  if (!result.changed) {
    return { member: result.after };
  }

  await auth.revokeRefreshTokens(input.memberId);
  await audit({
    actorMemberId: caller.uid,
    action: 'role_changed',
    targetMemberId: input.memberId,
    entityRef: memberRef.path,
    before: { role: result.before.role },
    after: { role: result.after.role },
  });
  await createNotification(
    input.memberId,
    'security',
    result.after.role === 'admin' ? 'You are now an admin' : 'Your admin access was removed',
    result.after.role === 'admin'
      ? 'An admin gave your account admin access.'
      : 'Your account no longer has admin access.',
    {},
  );

  return { member: result.after };
}

export const setMemberRole = onCall(callableOptions, setMemberRoleHandler);

/* --------------------------------- deactivateMember ----------------------------- */

export async function deactivateMemberHandler(
  req: CallableRequest<DeactivateMemberInput>,
): Promise<DeactivateMemberResult> {
  const input = parseInput(DeactivateMemberInputSchema, req.data);
  const caller = await requireAdmin(req);

  const memberRef = db.doc(paths.member(input.memberId));
  const { member, wasActive } = await db.runTransaction(async (tx) => {
    const snap = await tx.get(memberRef);
    const m = snap.data() as Member | undefined;
    if (!m) throw new HttpsError('not-found', 'Member not found.');
    if (!m.active) {
      return { member: m, wasActive: false };
    }

    if (m.role === 'admin') {
      const adminsSnap = await tx.get(
        db.collection(paths.members()).where('role', '==', 'admin').where('active', '==', true),
      );
      const otherActiveAdmins = adminsSnap.docs.filter((d) => d.id !== input.memberId);
      if (otherActiveAdmins.length === 0) {
        throw new HttpsError('failed-precondition', 'You cannot deactivate the only active admin.');
      }
    }

    const now = new Date().toISOString();
    const updated: Member = { ...m, active: false, deactivatedAt: now, updatedAt: now };
    tx.set(memberRef, updated);
    return { member: updated, wasActive: true };
  });

  if (!wasActive) {
    return { member, cancelledEntries: 0, expiredInvites: 0 };
  }

  await auth.updateUser(input.memberId, { disabled: true });
  await auth.revokeRefreshTokens(input.memberId);

  const memberName = `${member.firstName} ${member.lastName}`;

  // ---- cascade-cancel every future non-cancelled entry, exactly like cancelEntry ----
  // Team entries are excluded here: `removeMemberFromAllTeams` (below) already
  // cancels the member's future team entries as part of removing them from the
  // roster (and handles captaincy transfer/disbanding) — running the plain
  // cascade over them too would fire a redundant `team_member_absent`
  // notification per remaining session instead of the roster-level handling
  // that hook already provides.
  const today = todayNZ();
  const entriesSnap = await db
    .collection(paths.entries())
    .where('memberId', '==', input.memberId)
    .where('date', '>=', today)
    .get();

  let cancelledEntries = 0;
  const pendingNotifications: CancelEntryNotification[] = [];

  for (const doc of entriesSnap.docs) {
    const entryRefId = doc.id;
    const cascadeResult = await db.runTransaction(async (tx) => {
      const snap = await tx.get(db.doc(paths.entry(entryRefId)));
      const entry = snap.data() as Entry | undefined;
      if (!entry || entry.status === 'cancelled' || entry.teamId) return null;
      return cancelEntryInTx(tx, entry, { actorMemberId: input.memberId, actorName: memberName });
    });
    if (!cascadeResult) continue;
    cancelledEntries += 1;
    for (const n of cascadeResult.notify) pendingNotifications.push(n);
  }

  for (const n of pendingNotifications) {
    await createNotification(n.memberId, n.type, n.title, n.body, n.data);
  }

  // ---- expire pending invites in both directions, notify the counterpart ----
  const [outgoingSnap, incomingSnap] = await Promise.all([
    db.collection(paths.invites()).where('fromMemberId', '==', input.memberId).where('status', '==', 'pending').get(),
    db.collection(paths.invites()).where('toMemberId', '==', input.memberId).where('status', '==', 'pending').get(),
  ]);

  let expiredInvites = 0;
  const now = new Date().toISOString();
  const writer = new BatchWriter();

  for (const doc of outgoingSnap.docs) {
    const invite = doc.data() as Invite;
    writer.update(doc.ref, { status: 'expired', updatedAt: now });
    expiredInvites += 1;
    await createNotification(
      invite.toMemberId,
      'invite_expired',
      'An invite expired',
      `The invite from ${memberName} has expired.`,
      { inviteId: invite.id },
    );
  }
  for (const doc of incomingSnap.docs) {
    const invite = doc.data() as Invite;
    writer.update(doc.ref, { status: 'expired', updatedAt: now });
    expiredInvites += 1;
    await createNotification(
      invite.fromMemberId,
      'invite_expired',
      'An invite expired',
      `Your invite to ${memberName} has expired.`,
      { inviteId: invite.id },
    );
  }
  await writer.flush();

  await removeMemberFromAllTeams(input.memberId);

  await audit({
    actorMemberId: caller.uid,
    action: 'member_deactivated',
    targetMemberId: input.memberId,
    entityRef: memberRef.path,
    detail: { cancelledEntries, expiredInvites, reason: input.reason ?? null },
  });

  logger.info('member_deactivated', { targetMemberId: input.memberId, cancelledEntries, expiredInvites });

  // No notification to the member themselves — they can no longer sign in (plan task brief).
  return { member, cancelledEntries, expiredInvites };
}

export const deactivateMember = onCall(callableOptions, deactivateMemberHandler);

/* --------------------------------- reactivateMember ------------------------------ */

export async function reactivateMemberHandler(
  req: CallableRequest<ReactivateMemberInput>,
): Promise<ReactivateMemberResult> {
  const input = parseInput(ReactivateMemberInputSchema, req.data);
  const caller = await requireAdmin(req);

  const memberRef = db.doc(paths.member(input.memberId));
  const { member, changed } = await db.runTransaction(async (tx) => {
    const snap = await tx.get(memberRef);
    const m = snap.data() as Member | undefined;
    if (!m) throw new HttpsError('not-found', 'Member not found.');
    if (m.active) {
      return { member: m, changed: false };
    }
    const now = new Date().toISOString();
    const rest: Member = { ...m };
    delete rest.deactivatedAt;
    const updated: Member = { ...rest, active: true, updatedAt: now };
    tx.set(memberRef, updated);
    return { member: updated, changed: true };
  });

  if (!changed) {
    return { member };
  }

  await auth.updateUser(input.memberId, { disabled: false });
  await audit({
    actorMemberId: caller.uid,
    action: 'member_reactivated',
    targetMemberId: input.memberId,
    entityRef: memberRef.path,
  });
  await createNotification(
    input.memberId,
    'security',
    'Your membership has been reactivated',
    'Your Orewa Bridge Club membership has been reactivated — welcome back.',
    {},
  );

  return { member };
}

export const reactivateMember = onCall(callableOptions, reactivateMemberHandler);

/* ----------------------------------- eraseMember --------------------------------- */

export async function eraseMemberHandler(req: CallableRequest<EraseMemberInput>): Promise<EraseMemberResult> {
  const input = parseInput(EraseMemberInputSchema, req.data);
  const caller = await requireAdmin(req);

  const memberRef = db.doc(paths.member(input.memberId));
  const memberSnap = await memberRef.get();
  const member = memberSnap.data() as Member | undefined;
  if (!member) throw new HttpsError('not-found', 'Member not found.');
  if (member.active) {
    throw new HttpsError('failed-precondition', 'Deactivate this member before erasing them.');
  }
  if (!member.deactivatedAt) {
    throw new HttpsError(
      'failed-precondition',
      'This member has no recorded deactivation date; the 30-day wait cannot be verified.',
    );
  }
  if (Date.now() - new Date(member.deactivatedAt).getTime() < THIRTY_DAYS_MS) {
    throw new HttpsError('failed-precondition', 'Members must be deactivated for at least 30 days before they can be erased.');
  }
  const expectedName = `${member.firstName} ${member.lastName}`;
  if (input.confirmName !== expectedName) {
    throw new HttpsError('invalid-argument', 'confirmName does not match this member\'s current name.');
  }

  const now = new Date().toISOString();

  // 1. members/{uid}: scrub PII, mark erased.
  const scrubbedMember: Member = {
    ...member,
    firstName: 'Former',
    lastName: 'Member',
    phone: '',
    erasedAt: now,
    updatedAt: now,
  };
  await memberRef.set(scrubbedMember);

  // 2. memberPrivate/{uid}: scrub PII, reset prefs/devices.
  const privateRef = db.doc(paths.memberPrivate(input.memberId));
  const privateSnap = await privateRef.get();
  const existingPrivate = privateSnap.data() as MemberPrivate | undefined;
  const scrubbedPrivate: MemberPrivate = {
    id: input.memberId,
    emailLower: `erased-${input.memberId}@erased.invalid`,
    notificationPrefs: DEFAULT_NOTIFICATION_PREFS,
    devices: [],
    hasPassword: false,
    createdAt: existingPrivate?.createdAt ?? now,
    updatedAt: now,
  };
  await privateRef.set(scrubbedPrivate);

  const writer = new BatchWriter();

  // 3. visitors owned by this member: delete every doc.
  const visitorsSnap = await db.collection(paths.visitors()).where('createdByMemberId', '==', input.memberId).get();
  for (const doc of visitorsSnap.docs) writer.delete(doc.ref);

  // 4. entries referencing this member as partner/substitute/partnerSubstitute
  //    (any date — history is kept, only the denormalised name is anonymised).
  const patchByEntryId = new Map<string, Record<string, unknown>>();
  for (const field of ['partner', 'substitute', 'partnerSubstitute'] as const) {
    const snap = await db.collection(paths.entries()).where(`${field}.memberId`, '==', input.memberId).get();
    for (const doc of snap.docs) {
      const entry = doc.data() as Entry;
      const ref = entry[field];
      if (!ref || ref.kind !== 'member' || ref.memberId !== input.memberId) continue;
      const patch = patchByEntryId.get(doc.id) ?? {};
      patch[field] = { ...ref, displayName: 'Former member' };
      patchByEntryId.set(doc.id, patch);
    }
  }
  for (const [id, patch] of patchByEntryId) {
    writer.update(db.doc(paths.entry(id)), { ...patch, updatedAt: now });
  }

  // 5. teams.members[].ref displayName -> 'Former member' wherever this member appears.
  const teamsSnap = await db.collection(paths.teams()).get();
  for (const doc of teamsSnap.docs) {
    const team = doc.data() as Team;
    let changed = false;
    const members = team.members.map((m) => {
      if (m.ref.kind === 'member' && m.ref.memberId === input.memberId && m.ref.displayName !== 'Former member') {
        changed = true;
        return { ...m, ref: { ...m.ref, displayName: 'Former member' } };
      }
      return m;
    });
    if (changed) writer.update(doc.ref, { members, updatedAt: now });
  }

  // 6. notifications addressed to this member: delete.
  const notificationsSnap = await db.collection(paths.notifications()).where('memberId', '==', input.memberId).get();
  for (const doc of notificationsSnap.docs) writer.delete(doc.ref);

  await writer.flush();

  // 7. Auth user deleted last — only once every Firestore scrub above has
  //    succeeded, so a mid-way failure never leaves a deleted Auth account
  //    next to still-unscrubbed personal data.
  try {
    await auth.deleteUser(input.memberId);
  } catch (err) {
    const code = (err as { code?: string } | undefined)?.code;
    if (code !== 'auth/user-not-found') throw err;
  }

  await audit({
    actorMemberId: caller.uid,
    action: 'member_erased',
    targetMemberId: input.memberId,
    entityRef: memberRef.path,
    before: { memberId: input.memberId },
    after: { erasedAt: now },
  });

  return { ok: true };
}

export const eraseMember = onCall(callableOptions, eraseMemberHandler);

/**
 * Auth guards for callable functions. Every privileged callable starts by
 * resolving the caller to an active `Member`, and admin-only paths add
 * `requireAdmin`.
 */
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { paths, type ClubPaths, type Member } from '@obc/shared';
import { db } from './admin.js';
import { activeMembershipsOf } from './clubs.js';

export interface Caller {
  uid: string;
  /** The caller's membership record in `cp`'s club. */
  member: Member;
  /** Admin of `cp`'s club (plan §21 B14.3: admin rights are per club). */
  isAdmin: boolean;
  /** The club this request acts in. */
  cp: ClubPaths;
}

/** The caller must be an active member of the club the request acts in. */
export async function requireMember(req: CallableRequest, cp: ClubPaths): Promise<Caller> {
  const uid = req.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to continue.');
  }
  const snap = await db.doc(cp.member(uid)).get();
  const member = snap.data() as Member | undefined;
  if (!member || member.active !== true) {
    throw new HttpsError('permission-denied', 'Your membership is not active.');
  }
  return { uid, member, isAdmin: member.role === 'admin', cp };
}

/**
 * For person-level callables (password, notification prefs, devices, marking
 * notifications read): the caller must hold an active membership of SOME
 * club, but the action is not about any one of them.
 */
export async function requireUser(req: CallableRequest): Promise<{ uid: string }> {
  const uid = req.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to continue.');
  }
  if ((await activeMembershipsOf(uid)).length === 0) {
    throw new HttpsError('permission-denied', 'Your membership is not active.');
  }
  return { uid };
}

/**
 * The caller must be a platform administrator (plan §21 B14.3): signed in,
 * with a `platformAdmins/{uid}` document. That document is the whole grant —
 * it is written only by `make-platform-admin.ts`, never by a callable, so no
 * request can promote anyone.
 *
 * Being a platform admin confers nothing INSIDE a club: every club-scoped
 * callable still checks the caller's membership of that club.
 */
export async function requirePlatformAdmin(req: CallableRequest): Promise<{ uid: string }> {
  const uid = req.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to continue.');
  }
  if (!(await db.doc(paths.platformAdmin(uid)).get()).exists) {
    throw new HttpsError('permission-denied', 'Platform administrators only.');
  }
  return { uid };
}

export async function requireAdmin(req: CallableRequest, cp: ClubPaths): Promise<Caller> {
  const caller = await requireMember(req, cp);
  if (!caller.isAdmin) {
    throw new HttpsError('permission-denied', 'Admins only.');
  }
  return caller;
}

/**
 * Resolve the member an action targets. When `onBehalfOfMemberId` is supplied the
 * caller must be an admin; otherwise the action targets the caller.
 */
export interface ActingMember {
  memberId: string;
  /** The member the action is performed as — never the admin, when acting on behalf. Use this for any user-facing name. */
  member: Member;
  onBehalfBy?: string;
}

export async function resolveActingMember(caller: Caller, onBehalfOfMemberId?: string): Promise<ActingMember> {
  if (!onBehalfOfMemberId || onBehalfOfMemberId === caller.uid) {
    return { memberId: caller.uid, member: caller.member };
  }
  if (!caller.isAdmin) {
    throw new HttpsError('permission-denied', 'Only admins can act on behalf of members.');
  }
  const target = await db.doc(caller.cp.member(onBehalfOfMemberId)).get();
  const member = target.data() as Member | undefined;
  if (!member) {
    throw new HttpsError('not-found', 'Target member not found.');
  }
  // Audit L2: acting on behalf of a deactivated member would silently undo
  // the deactivation cascade's guarantees (their future entries were
  // cancelled). Reactivate first, then act.
  if (member.active !== true) {
    throw new HttpsError('failed-precondition', 'That member is not active. Reactivate them first.');
  }
  return { memberId: onBehalfOfMemberId, member, onBehalfBy: caller.uid };
}

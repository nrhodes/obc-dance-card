/**
 * Auth guards for callable functions. Every privileged callable starts by
 * resolving the caller to an active `Member`, and admin-only paths add
 * `requireAdmin`.
 */
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import type { Member } from '@obc/shared';
import { db } from './admin.js';
import { paths } from '@obc/shared';

export interface Caller {
  uid: string;
  member: Member;
  isAdmin: boolean;
}

export async function requireMember(req: CallableRequest): Promise<Caller> {
  const uid = req.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to continue.');
  }
  const snap = await db.doc(paths.member(uid)).get();
  const member = snap.data() as Member | undefined;
  if (!member || member.active !== true) {
    throw new HttpsError('permission-denied', 'Your membership is not active.');
  }
  return { uid, member, isAdmin: member.role === 'admin' };
}

export async function requireAdmin(req: CallableRequest): Promise<Caller> {
  const caller = await requireMember(req);
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
  const target = await db.doc(paths.member(onBehalfOfMemberId)).get();
  const member = target.data() as Member | undefined;
  if (!member) {
    throw new HttpsError('not-found', 'Target member not found.');
  }
  return { memberId: onBehalfOfMemberId, member, onBehalfBy: caller.uid };
}

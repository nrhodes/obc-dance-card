/**
 * Password set/remove (plan §8.2 "Password", §9.2 `markPasswordSet` /
 * `removePassword`). Firebase cannot "unset" a password, so removal rotates
 * it to an unknowable random value and flips `hasPassword=false` — the UI
 * presents this as "Remove password".
 */
import { randomBytes } from 'node:crypto';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import {
  MarkPasswordSetInputSchema,
  RemovePasswordInputSchema,
  paths,
  type MarkPasswordSetInput,
  type RemovePasswordInput,
} from '@obc/shared';
import { auth, db } from '../lib/admin.js';
import { callableOptions } from '../lib/callable.js';
import { requireMember } from '../lib/context.js';
import { createNotification } from '../notifications/create.js';
import { parseInput } from '../lib/parseInput.js';

export async function markPasswordSetHandler(
  req: CallableRequest<MarkPasswordSetInput>,
): Promise<{ ok: true }> {
  parseInput(MarkPasswordSetInputSchema, req.data);
  const caller = await requireMember(req);

  // Do not take the client's word for it: `hasPassword` drives UI and the
  // security notification, so confirm Auth actually has a password provider
  // linked for this user.
  const user = await auth.getUser(caller.uid);
  const hasPasswordProvider = user.providerData.some((p) => p.providerId === 'password');
  if (!hasPasswordProvider) {
    throw new HttpsError('failed-precondition', 'No password has been set on this account.');
  }

  await db
    .doc(paths.memberPrivate(caller.uid))
    .set({ hasPassword: true, updatedAt: new Date().toISOString() }, { merge: true });

  await createNotification(
    caller.uid,
    'security',
    'Password set',
    'A password was set on your Orewa Bridge Club account.',
  );

  return { ok: true };
}

export const markPasswordSet = onCall(callableOptions, markPasswordSetHandler);

export async function removePasswordHandler(
  req: CallableRequest<RemovePasswordInput>,
): Promise<{ ok: true }> {
  parseInput(RemovePasswordInputSchema, req.data);
  const caller = await requireMember(req);

  // Firebase has no "unset password" API: rotate to an unknowable value.
  const unknowablePassword = randomBytes(64).toString('base64');
  await auth.updateUser(caller.uid, { password: unknowablePassword });

  await db
    .doc(paths.memberPrivate(caller.uid))
    .set({ hasPassword: false, updatedAt: new Date().toISOString() }, { merge: true });

  await auth.revokeRefreshTokens(caller.uid);

  await createNotification(
    caller.uid,
    'security',
    'Password removed',
    'Your password was removed. Sign in with an emailed code instead.',
  );

  return { ok: true };
}

export const removePassword = onCall(callableOptions, removePasswordHandler);

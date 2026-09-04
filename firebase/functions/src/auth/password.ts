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
  RECENT_LOGIN_REQUIRED_REASON,
  RemovePasswordInputSchema,
  SetPasswordInputSchema,
  paths,
  passwordStrengthError,
  type MarkPasswordSetInput,
  type RemovePasswordInput,
  type SetPasswordInput,
} from '@obc/shared';
import { auth, db } from '../lib/admin.js';
import { callableOptions } from '../lib/callable.js';
import { requireMember } from '../lib/context.js';
import { createNotification } from '../notifications/create.js';
import { parseInput } from '../lib/parseInput.js';

/**
 * A caller must have signed in within this window to set a password (audit
 * M1 — plan §8.2 originally required "recent login" via Firebase's own
 * `updatePassword`/`requires-recent-login` mechanism, which bounced the
 * member to a re-auth screen; that navigation-away was the real UX problem,
 * not the freshness check itself). Enforced server-side against the ID
 * token's `auth_time` claim so it can't be spoofed by the client.
 *
 * 10 minutes, not the plan's original 5: a member who has *just* signed in
 * and goes straight to Profile to set a password must not be re-prompted —
 * that would recreate the exact confusion this fix removes. Set server-side
 * with `setPasswordHandler`; the client never sees or controls this value.
 */
const RECENT_LOGIN_WINDOW_SECONDS = 10 * 60;

/**
 * Set (or replace) the member's password, server-side, using the member's
 * current session. Requires a recent sign-in (see `RECENT_LOGIN_WINDOW_SECONDS`
 * above) — enforced here, not by client-side `updatePassword`, so the
 * re-authentication (when needed) happens inline in the same screen instead
 * of navigating the member away (plan §8.2; audit M1). Strength is enforced
 * with the shared policy.
 */
export async function setPasswordHandler(req: CallableRequest<SetPasswordInput>): Promise<{ ok: true }> {
  const { password } = parseInput(SetPasswordInputSchema, req.data);
  const caller = await requireMember(req);

  const authTime = req.auth?.token.auth_time;
  const nowSeconds = Date.now() / 1000;
  if (typeof authTime !== 'number' || nowSeconds - authTime > RECENT_LOGIN_WINDOW_SECONDS) {
    throw new HttpsError('failed-precondition', "For your security, please confirm it's you first.", {
      reason: RECENT_LOGIN_REQUIRED_REASON,
    });
  }

  const strengthError = passwordStrengthError(password);
  if (strengthError) {
    throw new HttpsError('invalid-argument', strengthError);
  }

  await auth.updateUser(caller.uid, { password });
  await db
    .doc(paths.memberPrivate(caller.uid))
    .set({ hasPassword: true, updatedAt: new Date().toISOString() }, { merge: true });

  await createNotification(
    caller.uid,
    'security',
    'Password set',
    'A password was set on your Orewa Bridge Club account. If this was not you, contact the club.',
  );

  return { ok: true };
}

export const setPassword = onCall(callableOptions, setPasswordHandler);

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

  // Intentionally NOT revoking refresh tokens: the current session is
  // legitimate and signing in by code does not depend on the password.
  // Rotating the password above already stops it working for future sign-ins.

  await createNotification(
    caller.uid,
    'security',
    'Password removed',
    'Your password was removed. Sign in with an emailed code instead.',
  );

  return { ok: true };
}

export const removePassword = onCall(callableOptions, removePasswordHandler);

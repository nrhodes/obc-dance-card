/**
 * Identity Platform blocking functions (plan §8.2 "Blocking functions").
 * `beforeUserCreated`/`beforeSignIn` are the deployed trigger names in the
 * plan; the underlying SDK functions are `beforeUserCreated` and
 * `beforeUserSignedIn`. Admin SDK `auth.createUser` calls (used by
 * `importMembers`) do NOT trigger these — only client-initiated
 * creation/sign-in does.
 *
 * Handlers are exported unwrapped so tests can call them directly with a
 * fake `AuthBlockingEvent` — see `src/testing/README.md`.
 */
import {
  beforeUserCreated as beforeUserCreatedTrigger,
  beforeUserSignedIn,
  HttpsError,
  type AuthBlockingEvent,
} from 'firebase-functions/v2/identity';
import { activeMembershipsOf } from '../lib/clubs.js';

const REGION = 'australia-southeast1';

const NO_SELF_SIGNUP_MESSAGE = 'Accounts are created by the club. Please contact the club.';
const NOT_ACTIVE_MESSAGE = 'Your membership is not active. Please contact the club.';

export function beforeUserCreatedHandler(): never {
  throw new HttpsError('permission-denied', NO_SELF_SIGNUP_MESSAGE);
}

export const beforeUserCreated = beforeUserCreatedTrigger({ region: REGION }, beforeUserCreatedHandler);

export async function beforeSignInHandler(event: AuthBlockingEvent): Promise<void> {
  const uid = event.data?.uid;
  if (!uid) {
    throw new HttpsError('permission-denied', NOT_ACTIVE_MESSAGE);
  }
  // Any active membership admits the person (plan §21 B14.3).
  if ((await activeMembershipsOf(uid)).length === 0) {
    throw new HttpsError('permission-denied', NOT_ACTIVE_MESSAGE);
  }
}

export const beforeSignIn = beforeUserSignedIn({ region: REGION }, beforeSignInHandler);

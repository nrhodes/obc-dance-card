/**
 * Single Firebase initialisation point. Every other module imports `auth`,
 * `db`, `functions`, or the `callable` helper from here — never calls
 * `initializeApp`/`getAuth`/etc. itself (plan §14.1).
 *
 * Auth persistence is left at the SDK default (local/IndexedDB) — see plan
 * §14.1 "Auth persistence: local (default). No manual token storage." — and
 * Firestore offline persistence is never enabled (shared devices, plan §8.1).
 */
import { initializeApp } from 'firebase/app';
import { FirebaseError } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';

const env = import.meta.env;

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

const region = env.VITE_FUNCTIONS_REGION || 'australia-southeast1';
const useEmulators = env.VITE_USE_EMULATORS === 'true';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Firestore offline persistence is intentionally NOT enabled here — see
// module docstring.
export const db = getFirestore(app);
export const functions = getFunctions(app, region);

if (useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

/** Small, display-safe error shape. Never carries a raw Firebase message to the UI unmapped. */
export interface AppError {
  code: string;
  message: string;
}

/**
 * Normalises a thrown `FirebaseError` (from Auth or a callable) into
 * `AppError`. Callable errors arrive with codes prefixed `functions/`
 * (e.g. `functions/resource-exhausted`); this strips the prefix so callers
 * can compare against the plain HttpsError codes used throughout the plan
 * (§8.3): `unauthenticated | permission-denied | invalid-argument |
 * failed-precondition | not-found | resource-exhausted`.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof FirebaseError) {
    const code = err.code.startsWith('functions/') ? err.code.slice('functions/'.length) : err.code;
    return { code, message: err.message };
  }
  if (err instanceof Error) {
    return { code: 'unknown', message: err.message };
  }
  return { code: 'unknown', message: 'Something went wrong.' };
}

/**
 * Typed wrapper around `httpsCallable`. Never logs the input or output (plan
 * §3/§8.1: never log codes, tokens, emails, phones) — callers that need to
 * report a failure should use `toAppError` + a mapped, display-safe message,
 * not the raw error.
 */
export function callable<I, O>(name: string) {
  const fn = httpsCallable<I, O>(functions, name);
  return async (input: I): Promise<O> => {
    try {
      const result = await fn(input);
      return result.data;
    } catch (err) {
      throw toAppError(err);
    }
  };
}

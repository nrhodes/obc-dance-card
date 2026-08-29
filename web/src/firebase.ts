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
import { getMessaging, isSupported as isMessagingSupported, type Messaging } from 'firebase/messaging';

// `ImportMetaEnv` (vite-env.d.ts) doesn't declare the push-only vars this
// module also reads (`VITE_FIREBASE_MESSAGING_SENDER_ID`) — widened locally
// here rather than editing that shared type file (Phase 5b file ownership).
const env = import.meta.env as ImportMetaEnv & {
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
};

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  // Public sender id, required by `firebase/messaging` (plan Phase 5b / web
  // push). Not present in earlier phases' config — see `.env.example`. Only
  // spread in when set: `exactOptionalPropertyTypes` treats an explicit
  // `undefined` differently from an absent key.
  ...(env.VITE_FIREBASE_MESSAGING_SENDER_ID ? { messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID } : {}),
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

let messagingPromise: Promise<Messaging | null> | null = null;

/**
 * Lazily creates (and memoises) the Firebase Messaging instance for web push
 * (plan Phase 5b), or resolves to `null` where the browser can't support it
 * — most notably iOS/iPadOS Safari unless the site has been added to the
 * Home Screen, but also private-browsing modes without IndexedDB/Push API
 * support, and this project's own vitest/jsdom environment. `isSupported()`
 * (from `firebase/messaging`) is itself async and does the real feature
 * detection; this just memoises it and swallows a rejection into `null`
 * rather than letting a feature-detection failure surface as an unhandled
 * promise rejection.
 *
 * Deliberately lazy: nothing in this module calls this at import time (plan
 * §14.1's "no top-level side effects" — a page load must never register for
 * push or touch `Notification`/service-worker APIs on its own).
 */
export function getMessagingIfSupported(): Promise<Messaging | null> {
  if (!messagingPromise) {
    messagingPromise = isMessagingSupported()
      .then((supported) => (supported ? getMessaging(app) : null))
      .catch(() => null);
  }
  return messagingPromise;
}

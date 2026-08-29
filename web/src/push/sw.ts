/**
 * The app's one and only service worker (plan §14.1 PWA rules + Phase 5b web
 * push). Built by vite-plugin-pwa's `injectManifest` strategy (see
 * `vite.config.ts`) from this single TypeScript source, so exactly one
 * worker is ever registered, at scope `/`, and it does two jobs:
 *
 *  1. Precache the built app shell (Workbox), with the *same* "never touch
 *     Firestore/Functions" guarantee `vite.config.ts` documented for the
 *     old `generateSW` config: this file never imports `workbox-strategies`
 *     and never calls `registerRoute` for anything other than the
 *     same-origin SPA-shell fallback below, so there is no cache route that
 *     could ever intercept a Firestore/Auth/Functions request — those
 *     simply pass straight through to the network, untouched.
 *  2. Receive FCM background push messages and show a notification, and
 *     handle a click on that notification by focusing/opening the app at
 *     the right in-app route (`resolveDeepLink`, shared with the in-app
 *     notifications feed's own deep-linking).
 *
 * See `docs/web-push.md` for why this is one worker rather than two, and
 * for the Firebase config baked in below.
 *
 * Type-checking note: this file runs in the ServiceWorker global scope, but
 * `web/tsconfig.app.json` (not owned by this phase — see task file
 * ownership) type-checks all of `src/` under the DOM lib, not `webworker`.
 * Rather than add a second TS project (which would mean editing tsconfig
 * files outside this phase's scope), worker-only globals are accessed
 * through the narrow local `WorkerScope`/`NotificationClickEvent` types
 * below via a single boundary cast, instead of augmenting `self`'s global
 * type. Everything past that boundary is fully typed.
 */
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { initializeApp } from 'firebase/app';
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw';
import { resolveDeepLink, type DeepLinkData } from './deepLink';

/** The handful of ServiceWorkerGlobalScope members this file actually uses. */
interface WorkerClient {
  url: string;
  focus(): Promise<WorkerClient>;
  navigate?(url: string): Promise<WorkerClient | null>;
}

interface WorkerScope {
  __WB_MANIFEST: unknown;
  location: { origin: string };
  registration: {
    showNotification(title: string, options?: NotificationOptions): Promise<void>;
  };
  clients: {
    matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<WorkerClient[]>;
    openWindow(url: string): Promise<WorkerClient | null>;
  };
  addEventListener(type: 'notificationclick', listener: (event: NotificationClickEvent) => void): void;
}

interface NotificationClickEvent {
  notification: { close(): void; data?: unknown };
  waitUntil(promise: Promise<unknown>): void;
}

// `self` in this build is typed against the DOM lib's `Window` (see the
// note above) — this is the one, deliberate boundary cast into the real
// worker scope.
const worker = self as unknown as WorkerScope;

/* ------------------------------- app shell precache ------------------------------ */

// workbox's `injectManifest` build step finds where to splice the real
// precache manifest array by textually matching the literal expression
// `self.__WB_MANIFEST` in the built output (its `injectionPoint` default) —
// so this one call must spell it out as `self.__WB_MANIFEST`, not go
// through the `worker` alias above.
precacheAndRoute((self as unknown as WorkerScope).__WB_MANIFEST as Parameters<typeof precacheAndRoute>[0]);
cleanupOutdatedCaches();

// SPA fallback for a same-origin navigation that isn't itself precached
// (e.g. `/session/2027/xyz` typed directly into the address bar, or opened
// offline). `NavigationRoute` only ever matches `request.mode === 'navigate'`
// — by definition a top-level document load in *this* worker's own scope —
// so it can never intercept a cross-origin Firestore/Functions/Auth
// request regardless of the denylist; the denylist below exists only to
// keep Firebase Hosting's own reserved `/__/...` paths (auth helpers, the
// dynamic `/__/firebase/init.json`, etc.) working normally rather than
// being swallowed into the cached app shell.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/__\//] }));

/* --------------------------------- FCM background ------------------------------- */

// Public web config, baked in at build time from the same `VITE_FIREBASE_*`
// vars `src/firebase.ts` reads (plan §14.1: these are public identifiers,
// not secrets — see `.env.example`). A service worker cannot read
// `import.meta.env` at *runtime*; Vite replaces these expressions at build
// time instead (vite-plugin-pwa's `injectManifest` build runs `sw.ts`
// through a real Vite build using the same config/env, not a bare esbuild
// pass — see docs/web-push.md).
const senderId = (import.meta.env as Record<string, string | undefined>).VITE_FIREBASE_MESSAGING_SENDER_ID;
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  // Spread in only when set — `exactOptionalPropertyTypes` treats an
  // explicit `undefined` differently from an absent key.
  ...(senderId ? { messagingSenderId: senderId } : {}),
};

const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);

onBackgroundMessage(messaging, (payload) => {
  const title = payload.notification?.title ?? 'Orewa Bridge Club';
  const body = payload.notification?.body ?? '';
  const data = (payload.data ?? {}) as DeepLinkData;
  void worker.registration.showNotification(title, { body, data });
});

worker.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = (event.notification.data ?? {}) as DeepLinkData;
  const path = resolveDeepLink(data);
  const url = new URL(path, worker.location.origin).href;

  event.waitUntil(
    (async () => {
      const clients = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = clients.find((client) => client.url.startsWith(worker.location.origin));
      if (existing) {
        await existing.focus();
        if (existing.navigate) {
          await existing.navigate(url);
        }
        return;
      }
      await worker.clients.openWindow(url);
    })(),
  );
});

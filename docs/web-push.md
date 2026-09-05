# Web push notifications (Phase 5b)

How the web client turns `notify()` (plan §11) into an OS-level notification
on a member's phone or laptop, and how to develop/test it locally. This
covers only the **client** half — the server side (`notify`, the
`onNotificationCreated` fan-out trigger, `FcmPushProvider`) is
`firebase/functions/src/notifications/dispatch.ts` and out of scope here.

## Architecture: one service worker, not two

The obvious approach — Firebase's own tutorials — is a dedicated
`firebase-messaging-sw.js` registered *alongside* the PWA's own Workbox
precache worker. That doesn't work well here: **a page is controlled by at
most one active service worker per scope**, and this app already registers
one at scope `/` for offline app-shell precaching (plan §14.1). Registering
a second one at the same scope means whichever registers/activates last
"wins" control of the page, the two workers' lifecycles race each other on
every deploy, and it becomes unclear which one is even running push at any
given moment.

Instead, this project builds **one** worker from its own TypeScript source,
`web/src/push/sw.ts`, via `vite-plugin-pwa`'s `injectManifest` strategy
(`web/vite.config.ts`: `strategies: 'injectManifest'`, `srcDir: 'src/push'`,
`filename: 'sw.ts'`). That source file does both jobs a generateSW config
and a Firebase tutorial's `firebase-messaging-sw.js` would otherwise do
separately:

1. `precacheAndRoute(self.__WB_MANIFEST)` + a same-origin SPA navigation
   fallback — the exact same app-shell-only precaching the old `generateSW`
   config did, with the exact same guarantee: `sw.ts` never imports
   `workbox-strategies` or registers a caching route for anything but that
   one same-origin fallback, so Firestore/Auth/Functions requests are never
   written to a Workbox cache (plan §8.1/§14.1). `web/scripts/check-sw.mjs`
   (run as part of `npm test -w web`, see `src/push/checkSw.test.ts`) checks
   the built worker for exactly this.
2. `onBackgroundMessage` (from `firebase/messaging/sw`) to show a
   notification when a push arrives while the app isn't in the foreground,
   and a `notificationclick` handler that focuses (or opens) the app and
   navigates it to the right in-app route.

The build output is `dist/sw.js` (vite-plugin-pwa ties the output basename
to the source basename — `sw.ts` → `sw.js` — so it isn't literally named
`firebase-messaging-sw.js`, even though it *is* the FCM background handler).
That's fine, deliberately: the app never relies on Firebase's convention of
auto-discovering a service worker at `/firebase-messaging-sw.js` — `getToken`
is always called with an explicit `serviceWorkerRegistration`
(`web/src/push/usePush.ts`), pointing it at whichever worker
`navigator.serviceWorker.ready` resolves to. Calling the merged file `sw.js`
is more honest about what it now is: the app's one and only worker, not "the
push one".

`web/src/push/deepLink.ts` is the single source of truth for "given this
notification's `data`, which in-app route does it mean" — `sessionId` +
`year` → `/session/:year/:sessionId`; `inviteId` → `/invites`; anything else
→ `/notifications`. It mirrors (deliberately, as plain duplicated logic
rather than a shared import — the worker runs in a completely different
global scope and must not pull in React/router code)
`deepLinkFor` in `web/src/screens/NotificationsScreen.tsx`, which does the
same mapping for a tap inside the in-app notifications feed. Both read the
exact `data` shape the server actually sends — see
`firebase/functions/src/entries/lib.ts` and
`firebase/functions/src/notifications/matchmaking.ts`.

### A type-checking wrinkle worth knowing about

`sw.ts` runs in the `ServiceWorkerGlobalScope`, but `web/tsconfig.app.json`
(which `tsc -b`/`npm run typecheck -w web` uses for all of `src/`) type-checks
under the DOM lib, not `webworker` — and TypeScript doesn't allow a single
program to mix the two (their global `self`, `Client`, `Cache`, etc. types
conflict). The usual fix is a second `tsconfig` that only includes the
worker file, with `src/push/sw.ts` excluded from the main one. This phase's
file-ownership split doesn't include any `tsconfig*.json`, so `sw.ts`
instead accesses worker-only globals (`self.__WB_MANIFEST`,
`self.registration`, `self.clients`, the `notificationclick` event) through
a small local `WorkerScope` type and a single explicit
`self as unknown as WorkerScope` cast, rather than augmenting `self`'s
global type. Everything past that one boundary cast is normally typed. If a
later phase does add a dedicated worker `tsconfig`, this cast can be
replaced with `/// <reference lib="webworker" />` and it'll all still work.

## Registration flow (`usePush.ts` / `PushSettings.tsx`)

State machine: `unsupported | denied | prompt | enabled | error`. The
Profile screen never auto-prompts for permission — browsers won't show the
dialog without a click anyway — so the only place
`Notification.requestPermission()` is called is inside `enable()`, itself
only ever invoked from the "Turn on notifications on this device" button.

(Amended 2026-09-05.) iOS adds a **soft ask**: on the first signed-in launch,
while the OS hasn't been asked, the member-wide preference is on and the
member hasn't said "Not now" on this install, the app shows its own screen
explaining what notifications are for, with one button that triggers the
real iOS dialog. "Not now" is remembered per install and Profile's
"Notifications on this device" remains the fallback. Registration is still
tied to a granted permission — the phone is never registered "just in case".

- **Turn on** → request permission → `getToken(messaging, { vapidKey,
  serviceWorkerRegistration })` → `registerDevice({ token, platform: 'web',
  label })`, where `label` is a best-effort "Chrome on Windows"-style string
  (`src/push/deviceLabel.ts`). The token is cached in `localStorage` under
  `obc.pushToken`.
- **Rotation**: on mount, if permission is already `granted` and a token is
  cached, the hook calls `getToken` again (this never prompts once
  permission is already decided) purely to detect FCM rotating this
  device's token; if it changed, it registers the new one and unregisters
  the old one so `memberPrivate.devices` doesn't accumulate dead entries.
- **Turn off** → `unregisterDevice` + `deleteToken`, then forgets the local
  token.
- **Sign-out**: the local `obc.pushToken` key is cleared, but the
  server-side registration is deliberately left alone — plan §11 already has
  the server prune dead tokens itself (`dispatchNotification` in
  `dispatch.ts` removes tokens FCM reports as
  `registration-token-not-registered`), and there's no reason to force a
  round-trip on every sign-out.
- **Foreground messages** (`onMessage`) show a small in-app toast
  (`role="status"`) instead of an OS notification — plan brief: no OS
  notification while the app is already open and visible.
- **`notificationPrefs.push`** (the server-wide "does this member want push
  at all" toggle, `NotificationPrefsForm`) gates the *button*, not the
  hook's own state: if it's off, `PushSettings` explains that and disables
  "Turn on notifications on this device", but doesn't change `usePush`'s
  reported state (a device can be technically "enabled" — token registered
  — while the member has since turned the server-side preference off; the
  server's `wantedChannels` already checks `prefs.push` before ever sending
  to it either way).
- **iOS Safari**: `isSupported()` (from `firebase/messaging`) is `false` on
  iOS/iPadOS Safari unless the site has been added to the Home Screen. When
  that's why the state is `unsupported`, `PushSettings` shows: "On iPhone,
  add this site to your Home Screen (Share → Add to Home Screen) to receive
  notifications."

### Resolved in Phase 7b: the toast now fires app-wide

The limitation described below (kept for history) is fixed. The
foreground-message listener moved out of `usePush`/`PushSettings` into its
own `usePushForeground()` hook (`src/push/usePushForeground.ts`), mounted
once from `AppShell` — so the in-app toast now shows on whichever screen the
member happens to be on, not just Profile. `usePush` itself no longer knows
anything about the toast; it's purely the enable/disable/registration state
machine now.

<details>
<summary>Original note (Phase 5b)</summary>

`usePush`'s foreground-message listener is only mounted while
`<PushSettings />` is — i.e. only while the member is on the Profile screen.
Ideally the foreground-toast listener would be mounted once, app-wide, in
`AppShell`. That file is owned by the concurrent Phase 6b (admin UI) work in
this same phase window, and this phase's file ownership is deliberately
scoped to "a self-contained `<PushSettings />` … mount it in ProfileScreen
with a one-line change" — so this is the honest trade-off of that scope, not
an oversight. A background push (the actual point of this feature) is
unaffected either way — `onBackgroundMessage` in `sw.ts` fires regardless of
which screen, or whether the app, is open.

</details>

## VAPID key setup

Firebase console → **Project settings** → **Cloud Messaging** tab → **Web
configuration** → **Web Push certificates**. Generate a key pair if none
exists, then copy the "Key pair" value into `VITE_FIREBASE_VAPID_KEY`
(`.env`/`.env.example`). It's a public key, not a secret — it identifies
*your* Firebase project to the browser's push service, it doesn't grant
access to anything.

`VITE_FIREBASE_MESSAGING_SENDER_ID` (Project settings → General → "Project
number", also shown on the Cloud Messaging tab) is also required — the
modular SDK's `getMessaging()` needs it even though this project doesn't use
any other Firebase Cloud Messaging Android/legacy-server features. Also
public, not a secret.

## Testing

**Push cannot be exercised against the emulator** — there is no FCM
emulator, and `firebase/functions/src/notifications/dispatch.ts` already
accounts for this: outside a deployed function (`isDeployed()` false), it
uses `NoopPushProvider`, which just writes a doc to `emulatorOutbox` instead
of calling FCM. So the emulator is fine for developing/testing everything
*up to* "a token got registered" (`registerDevice`/`unregisterDevice`
themselves, the `usePush` state machine, `PushSettings`'s UI, the
`deepLink` mapping) but cannot prove an actual push arrives.

To test push end-to-end, you need a real (non-`demo-*`) Firebase project —
e.g. the `obc-dance-card-dev` project (plan §19):

1. Set real `VITE_FIREBASE_*` values (including
   `VITE_FIREBASE_MESSAGING_SENDER_ID` and `VITE_FIREBASE_VAPID_KEY`) in
   `web/.env.local`, pointed at that project, with `VITE_USE_EMULATORS=false`.
2. Deploy `firebase/functions` and `firebase/firestore.rules` to that
   project, and deploy hosting (`npm run deploy:hosting` — see root
   `package.json`) so the CSP headers and the built `sw.js` are actually
   served (push requires a real HTTPS origin; `localhost` also works for
   the Push API itself, but a real deploy is the more faithful test of the
   CSP).
3. Sign in as a real member on that project, go to **Profile**, click
   **"Turn on notifications on this device"**, accept the browser's
   permission prompt.
4. Trigger any notification (e.g. have another member send you an invite)
   and confirm the OS notification appears; background the tab first to
   test `onBackgroundMessage` specifically, or leave it foregrounded to see
   the in-app toast instead.
5. Click the notification and confirm it focuses/opens the app at the
   expected route (the session page for a session-scoped notification, the
   Invites screen for an invite one).

In Chrome DevTools, **Application → Service Workers** shows the registered
worker (should be exactly one, scope `/`) and **Application → Service
Workers → Push** (or `chrome://serviceworker-internals`) can simulate a push
event against it directly without needing a second device.

## CSP

Resolved in Phase 7b: `firebase/firebase.json`'s CSP now includes the
`worker-src 'self'` clause this section recommended (plus `manifest-src
'self'`, for the web app manifest). Covered by
`web/src/lib/csp.test.ts`. The rest of this section is kept for the
original analysis of why it was optional in the first place.

**Verdict: no change is required.** Web push needs two things from CSP:

- The page's own `getToken`/`deleteToken`/`onMessage` calls (main thread)
  talk to `fcmregistrations.googleapis.com` and
  `firebaseinstallations.googleapis.com`. The current
  `connect-src 'self' https://*.googleapis.com …` already covers both (they
  match the `*.googleapis.com` wildcard).
- Registering `sw.js` itself is governed by the `worker-src` directive,
  which — when absent, as it is today — falls back to `child-src`, then
  `script-src`, then `default-src` (per the CSP spec's directive fallback
  list). The current policy has no `worker-src`/`child-src`, so it falls
  back to `script-src 'self' https://www.gstatic.com https://www.google.com
  https://www.recaptcha.net`; the worker is same-origin (`self`), so this
  already allows it. The worker's *own* subsequent requests (if the
  Messaging SDK code running inside it ever calls `fetch`) are subject to
  the same CSP header (a worker's CSP comes from the response headers of
  the worker script itself, and Hosting sends the same header for every
  path), so they're covered by the same `connect-src` as above.

**Optional hardening, not required for correctness**: add an explicit
`worker-src 'self'` so the worker's permission doesn't depend on the
fallback chain (a handful of older browser versions implemented that
fallback inconsistently). If the orchestrator wants it, the exact updated
header value is:

```
Content-Security-Policy: default-src 'self'; script-src 'self' https://www.gstatic.com https://www.google.com https://www.recaptcha.net; worker-src 'self'; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.cloudfunctions.net https://*.run.app https://www.google.com; frame-src https://www.google.com https://recaptcha.google.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

(Only change from the current value in `firebase/firebase.json`: the
inserted `worker-src 'self';` clause.)

## Follow-ups noted but not implemented (out of this phase's scope)

- ~~`dispatchNotification`'s push payload (`dispatch.ts`) sends both a
  `notification` and a `data` block...~~ **Resolved in Phase 7b.**
  `FcmPushProvider` (`dispatch.ts`) now sends two separate multicasts:
  `platform: 'ios'` tokens keep `notification` + `data` (iOS needs the
  `notification` block while backgrounded); `platform: 'web'` tokens get a
  data-only message (`title`/`body` folded into `data`,
  `webpush.headers.Urgency: 'normal'`), and `sw.ts`'s
  `onBackgroundMessage` builds the notification itself from
  `data.title`/`data.body`. Covered by `dispatch.test.ts` (the
  `FcmPushProvider` split, mocked FCM) — `dispatch.emu.test.ts` can't
  exercise this itself, since the emulator always uses `NoopPushProvider`.
- No app icon is configured yet (`manifest.icons: []`,
  `web/vite.config.ts`) — `showNotification` in `sw.ts` therefore doesn't
  pass an `icon`, so notifications use the browser's generic icon. Once
  Phase 7's PWA install-icon work lands, `sw.ts` can point at it.

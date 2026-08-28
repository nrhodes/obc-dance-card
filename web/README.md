# web — OBC Dance Card PWA

React 18 + Vite + TypeScript PWA (plan §14.1). Serves the member and admin
screens for Phase 1b (sign in, profile, admin members import), Phase 2b
(programme browser, session page — read-only), and Phase 3b (My Dance Card,
invites inbox, live session actions, notifications feed).

## Routes

- `/signin` — sign in (code or password)
- `/` — **My Dance Card**: upcoming entries grouped by weekday → series, a
  collapsed "Past" (last 10), empty state, and the source of the nav's
  invites/notifications badges
- `/profile` — contact, prefs, password, sign out
- `/programme` — the published programme, by weekday
- `/session/:year/:sessionId` — one session's roster **and actions**: invite a
  partner (single session or whole series), "I'm looking for a partner" /
  "I'm available", claim a "looking for a partner" roster row, invite an
  "available" row, and cancel your own entry (with a plain-English
  consequence before you confirm). Visitor sign-up, arranging a substitute,
  and teams are disabled placeholders (Phase 4 / 4b)
- `/invites` — incoming (Accept/Decline), outgoing (Withdraw), and the last
  10 recently resolved invites
- `/notifications` — the last 50 notifications; tap to mark read and follow
  its deep link; "Mark all read"
- `/admin/members` — admin: members CSV import
- `/admin/programme` — admin: programme CSV import/publish, all-programmes list

## Stack

- React 18, React Router v6, TypeScript (strict, `noUncheckedIndexedAccess`)
- Firebase JS SDK v11 (modular) — `src/firebase.ts` is the single
  initialisation point
- `vite-plugin-pwa` (Workbox `generateSW`) — precaches the app shell only;
  Firestore/Functions/Auth requests are never cached (see `vite.config.ts`)
- Plain CSS (`src/styles.css`, CSS variables) — no UI kit
- Vitest + React Testing Library (unit/component tests), Playwright (E2E)

No other runtime dependencies (plan §14.1 / task spec: closed dependency
list).

## One-time setup

```sh
npm install                     # from the repo root
cp web/.env.example web/.env    # emulator defaults work as-is
```

For the functions emulator (auth codes, imports, etc.) you also need:

```sh
echo "LOGIN_CODE_PEPPER=local-dev-pepper" > firebase/functions/.secret.local
echo "SMTP_PASS=local-dev-smtp-pass" >> firebase/functions/.secret.local
```

Both secrets are declared on `requestLoginCode`/`verifyLoginCode` via
`defineSecret()` (`firebase/functions/src/lib/secrets.ts`); the Functions
emulator refuses to bind a declared secret it can't resolve, so `SMTP_PASS`
needs *a* value here even though the default `EMAIL_PROVIDER=console` never
actually sends SMTP mail.

## Running against the emulators

From the repo root, in order:

```sh
npm run build                      # builds @obc/shared (functions/web import its dist output)
npm run emulators                  # Firestore + Auth + Functions + Hosting, project demo-obc
npm run seed -w @obc/functions      # 20 fake members incl. admin@example.org
npm run dev -w web                  # Vite dev server on http://localhost:5173
```

`web/.env`'s defaults (`VITE_USE_EMULATORS=true`, project id `demo-obc`) point
the app at `127.0.0.1:9099` (Auth), `127.0.0.1:8080` (Firestore), and
`127.0.0.1:5001` (Functions) — see `src/firebase.ts`.

Sign in as the seeded admin (`admin@example.org`) with the emailed-code path,
or set a password on that account first via Profile.

## Tests

```sh
npm run test -w web        # vitest + RTL — mocks firebase/auth and firebase/functions, no network
npm run typecheck -w web
npm run lint -w web
```

### End-to-end (Playwright)

`web/e2e/signin.spec.ts` drives a real browser against the emulators: request
a code for `admin@example.org`, sign in, visit Profile, sign out.
`web/e2e/programme.spec.ts` signs in the same way, opens **Programme**, opens
the Monday tab, clicks the first "Marion Taylor Pairs" date, and confirms the
session page and its empty roster. `web/e2e/dancecard.spec.ts` drives **two**
browser contexts — the seeded admin and a seeded ordinary member
(`john.smith@example.org`) — through a full pairing/cancel cycle: the admin
lists themselves "Looking for a partner" on a future Monday session, the
second member claims it ("Play with Admin User"), both My Dance Cards show
the pairing, the admin then cancels, and the second member's card flips back
to "Looking for a partner" with a "Your partner cancelled" notification. All
three specs assume the emulators + seed + dev server are already running
(see above) — they do not start them themselves.

Because these specs sign in with an emailed code, running the full suite
more than 2-3 times inside a 15-minute window can trip the
`requestLoginCode` rate limit (plan §8.1: 3 requests / email / 15 min) — the
request still returns `{ ok: true }` (uniform response) but no email
arrives, and `waitForLoginCode` will time out. `dancecard.spec.ts` uses a
second seeded email precisely so it doesn't share a rate-limit budget with
the other two specs' admin sign-ins. Re-seed (which resets `rateLimits`) or
wait out the window if that happens.

```sh
npx playwright install chromium   # once
npm run test:e2e -w web
```

**Reading the login code.** The `console` email provider
(`firebase/functions/src/email/provider.ts`) prints the code to the functions
emulator's stdout, and — only when not deployed — also writes each message to
the Firestore collection `emulatorOutbox/{id}` (`{ to, subject, text,
createdAt }`). That collection is never written on a real deployment and is
unreadable by clients (firestore.rules' catch-all denies it).

- **Functions emulator stdout** — redirect it to a file
  (`npm run emulators > firebase-emulators.out 2>&1 &`) and look for a block
  like:

  ```
  --- email (console provider) ---
  To: admin@example.org
  Subject: Your Orewa Bridge Club sign-in code

  Your Orewa Bridge Club sign-in code is: 123456
  ...
  ```

- **Firestore Emulator UI** — open `http://127.0.0.1:4000/firestore`, open
  the `emulatorOutbox` collection, and read the newest doc's `text` field.

`web/e2e/signin.spec.ts` reads the same collection itself, via the Firestore
emulator's REST API `:runQuery` endpoint with the emulator's documented
`Authorization: Bearer owner` bypass token (only valid against the emulator),
picking the newest doc addressed to the sign-in email.

## Templates

`web/public/templates/*.csv` are generated, git-ignored copies of
`shared/templates/*.csv` (members, weekdays, series, singles), kept
byte-identical by `scripts/copy-templates.mjs` (runs via the
`predev`/`prebuild`/`pretest` npm hooks). `src/lib/templates.test.ts` asserts
every file matches — if it fails, run `node scripts/copy-templates.mjs` from
`web/`.

## Structure

```
src/
  firebase.ts              Firebase init, emulator wiring, callable() + AppError helper
  api.ts                   typed callable bindings used by the app
  auth/
    AuthProvider.tsx        auth + member/memberPrivate subscription, status state machine
    EmailCodeStep.tsx        shared "enter the code" UI (sign-in + Profile re-auth)
    useEmailCodeFlow.ts      request/verify/resend state machine
    errors.ts                error -> plain-English copy mapping
    passwordStrength.ts       mirrors the Firebase password policy
  components/
    AppShell.tsx             header, nav (+ invites/notifications badges), skip link, <main id="content">
    RouteGuards.tsx           signed-out / not-active / admin route guards
    Dialog.tsx                accessible modal primitive (role=dialog, focus trap, Escape)
    ConfirmDialog.tsx         generic confirm/cancel dialog (claim, cancel entry)
    SoloStatusDialog.tsx      "I'm looking for a partner" / "I'm available" + optional note
    InvitePartnerDialog.tsx   member picker + message + whole-series toggle
  programme/
    ProgrammeProvider.tsx     the shared "current published programme" subscription
    useProgramme.ts           read hook for weekdays/series/sessions
  members/
    MembersDirectoryProvider.tsx  subscribes to active members once; nameOf(id)
  invites/
    InvitesProvider.tsx       incoming/outgoing pending + last-10-resolved subscription
    useInvites.ts
  notifications/
    NotificationsProvider.tsx newest-50 notifications subscription; unread count
    useNotifications.ts
  lib/
    format.ts                 formatDateNZ/formatTimeOfDay/formatDateTimeNZ/shortWeekdayLabel
    roster.ts                 pure session-roster grouping (pairs/LFP/available/own entry)
    programmeView.ts          pure weekday-timeline grouping + default-tab logic
    card.ts                   pure My Dance Card grouping + per-status line text
    sessionActions.ts         pure session-page action state machine + cancel-consequence copy
    actionErrors.ts           shared callable-error -> display copy mapping
    memberPicker.ts           pure member-search filter (excludes self + already-confirmed)
  screens/
    SignInScreen.tsx, HomeScreen.tsx (My Dance Card), ProfileScreen.tsx, NotActiveScreen.tsx,
    NotificationPrefsForm.tsx, PasswordSection.tsx,
    ProgrammeScreen.tsx, SessionScreen.tsx (roster + actions),
    InvitesScreen.tsx, NotificationsScreen.tsx,
    admin/MembersImportScreen.tsx, admin/ProgrammeImportScreen.tsx,
    admin/AdminProgrammeList.tsx
```

# web — OBC Dance Card PWA

React 18 + Vite + TypeScript PWA (plan §14.1). Serves the member and admin
screens for Phase 1b (sign in, profile, admin members import), Phase 2b
(programme browser, session page — read-only), Phase 3b (My Dance Card,
invites inbox, live session actions, notifications feed), Phase 4c
(visitors, substitutes, teams), and Phase 6b (admin members/on-behalf,
programme editing, broadcast, audit log, integrity).

## Routes

- `/signin` — sign in (code or password)
- `/` — **My Dance Card**: upcoming entries grouped by weekday → series, a
  collapsed "Past" (last 10), empty state, a "Team" badge on team entries,
  and the source of the nav's invites/notifications badges
- `/profile` — contact, prefs, password, a link to **My visitors**, sign out
- `/visitors` — **My visitors**: list, add, edit, delete (with a non-blocking
  name-collision warning on add, and the server's verbatim refusal when a
  delete would remove a visitor with upcoming entries)
- `/programme` — the published programme, by weekday
- `/session/:year/:sessionId` — one session's roster **and actions**: invite a
  partner (single session or whole series), "I'm looking for a partner" /
  "I'm available", claim a "looking for a partner" roster row, invite an
  "available" row, cancel your own entry (with a plain-English consequence
  before you confirm), **play with a visitor** (single session or whole
  series), and **arrange/remove a substitute** on a confirmed member–member
  pairing (blocked with an explanation on a series that disallows it, or a
  visitor pairing). A Teams-format session instead shows the **Team panel**:
  start a team, invite a member, add a visitor, remove a member/visitor,
  transfer captaincy, disband, manage this session's absences/substitutes
  (captain), leave the team (member), or — when not on a team — the
  noticeboard ("Looking for a team" / "Available for a team") and a
  read-only list of the series' other teams
- `/invites` — incoming (Accept/Decline), outgoing (Withdraw), and the last
  10 recently resolved invites; team-scope invites are labelled "Team invite
  from `<captain>` — `<team name>` (`<series>`)" and captaincy offers "`<name>`
  wants you to be captain of `<team>`"
- `/notifications` — the last 50 notifications; tap to mark read and follow
  its deep link; "Mark all read"
- `/admin/members` — admin: **Members** (searchable table of every member,
  active or not; filter by status/role; make/remove admin, deactivate,
  reactivate, erase, and **Act on behalf**) and **Import CSV** (the members
  CSV import, unchanged, moved under a tab here)
- `/admin/programme` — admin: programme CSV import/publish, all-programmes
  list, and an **Edit series & sessions** panel (rename/rescoring/format/
  bestOf/substitute/notes/team size per series; title/kind/partner-required/
  date-move/remove per session, each showing its live non-cancelled sign-up
  count)
- `/admin/broadcast` — admin: title/body/optional-weekday broadcast with a
  live recipient-count preview before sending
- `/admin/audit` — admin: paged `auditLog` viewer (`listAuditLog` is the only
  read path — rules deny direct client reads), filterable by action/actor/
  target member, with an expandable `detail`/`before`/`after` `<pre>` view
- `/admin/integrity` — admin: **Run check** / **Run check and repair**
  against `runPairingSweep`, with a link into the audit log filtered to
  `pairing_repair` after a repair run

**Act on behalf** (`/admin/members`, plan §2): while active, a persistent
banner ("Acting on behalf of `<name>` — Stop") sits above the page, and every
member-facing screen (My Dance Card, Invites, the session page's actions,
visitors, teams) reads and writes as the acted-on member instead of the
signed-in admin — implemented via `src/admin/{ActingAsProvider,
useActingAs,useEffectiveMember}.ts` parameterising the existing providers.
Switching/removing a noticeboard listing is not offered while acting on
behalf (`clearSoloStatus` has no `onBehalfOfMemberId` in the plan's callable
catalogue — it always targets the caller).

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
to "Looking for a partner" with a "Your partner cancelled" notification.
`web/e2e/teams.spec.ts` drives two contexts — `mary.brown@example.org`
(captain) and `alex.taylor@example.org` — through starting a team on the
seeded **Campbell Cave Teams** session (2027-09-20), inviting the second
member, and that member accepting from Invites; both then see the team with
2 members and status Forming. `web/e2e/visitors.spec.ts` signs in as
`peter.wilson@example.org`, adds a visitor from Profile → **My visitors**,
opens the seeded **Campbell Cave Pairs** session (2027-02-08), and plays
with the visitor — the roster shows "`<name>` (visitor)". `web/e2e/admin.spec.ts`
signs in as the admin, opens **Admin: Members**, and clicks **Act on behalf**
of `susan.clark@example.org` — a member no other spec signs in — then opens
the seeded **Campbell Cave Pairs** session's second date (2027-02-15, a date
no other spec uses) and lists "I'm looking for a partner"; the roster shows
Susan Clark, not the admin. It stops acting, checks **Admin: Audit log**
(filtered to `set_solo_status_on_behalf`) for the admin-as-actor row, runs
**Admin: Integrity**'s "Run check" (0 violations on a fresh seed), then sends
an **Admin: Broadcast** and confirms it lands in Susan's Notifications feed
in a second browser context. All six specs assume the emulators + seed + dev
server are already running (see above) — they do not start them themselves.

Because these specs sign in with an emailed code, running the full suite
more than 2-3 times inside a 15-minute window can trip the
`requestLoginCode` rate limit (plan §8.1: 3 requests / email / 15 min) — the
request still returns `{ ok: true }` (uniform response) but no email
arrives, and `waitForLoginCode` will time out. `dancecard.spec.ts`,
`teams.spec.ts`, and `visitors.spec.ts` each sign in different seeded
members (`john.smith@example.org`; `mary.brown@example.org` +
`alex.taylor@example.org`; `peter.wilson@example.org`) precisely so none of
them shares a rate-limit budget with `signin.spec.ts` / `programme.spec.ts`'s
repeated `admin@example.org` sign-ins, or with each other — starting a team,
accepting a team invite, and adding/using a visitor are all plain-member
actions, so the admin role isn't needed for either new spec.
`admin.spec.ts` signs in `admin@example.org` once more and
`susan.clark@example.org` once — run it as **its own batch**, separate from
`signin.spec.ts` / `programme.spec.ts` / `dancecard.spec.ts` (which together
already spend all 3 of `admin@example.org`'s requests in one window), e.g.:

```sh
npx playwright test e2e/admin.spec.ts                                    # batch 1
npx playwright test e2e/signin.spec.ts e2e/programme.spec.ts e2e/dancecard.spec.ts e2e/teams.spec.ts e2e/visitors.spec.ts  # batch 2
```

If a spec's sign-in does trip the limit, restart the emulators (re-seeding
alone does **not** reset `rateLimits` — that collection, like every other,
only clears when the in-memory Firestore emulator process itself restarts)
or wait out the 15-minute window.

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
  admin/
    ActingAsContext.ts        acting-as target ({memberId, name}) + start/stop
    ActingAsProvider.tsx      admin-only in-memory acting-as state, cleared on sign-out/non-admin
    useActingAs.ts            raw context hook
    useEffectiveMember.ts     derived {effectiveMemberId, onBehalfOfMemberId, actingAsName}, used by
                              every provider/screen that reads/writes "my" data
    adminErrors.ts            admin callable-error -> display copy (failed-precondition AND
                              invalid-argument shown verbatim — every admin-only error is display-safe)
  components/
    AppShell.tsx             header, nav (+ invites/notifications badges, admin section), the
                              acting-as banner, skip link, <main id="content">
    RouteGuards.tsx           signed-out / not-active / admin route guards
    Dialog.tsx                accessible modal primitive (role=dialog, focus trap, Escape)
    ConfirmDialog.tsx         generic confirm/cancel dialog (claim, cancel entry, ...); optional
                              admin-only "override a locked session" checkbox (force)
    SubscriptionError.tsx     shared inline notice for a failed onSnapshot ("Couldn't load X")
    SoloStatusDialog.tsx      "I'm looking for a partner/team" / "I'm available[for a team]" + note
    InvitePartnerDialog.tsx   member picker + message + whole-series toggle
    VisitorForm.tsx           add/edit visitor fields (name/email/phone/notes/courtesy email)
    VisitorPickerDialog.tsx   pick or add-inline a visitor, optional whole-series toggle
    PartnerPickerDialog.tsx   pick a member or one of my visitors (substitutes, team session subs)
    SubstituteDialog.tsx      coverFor choice, then PartnerPickerDialog
    InviteToTeamDialog.tsx    member picker + message, for a team captain's invite
    TransferCaptaincyDialog.tsx  pick a team member, then confirm the offer
    StartTeamDialog.tsx       optional team name
    TeamPanel.tsx             the Team panel (captain/member/not-on-team views + every team action;
                              threads onBehalfOfMemberId when acting on behalf)
  programme/
    ProgrammeProvider.tsx     the shared "current published programme" subscription; exposes `error`
    useProgramme.ts           read hook for weekdays/series/sessions
  members/
    MembersDirectoryProvider.tsx  subscribes to active members once; nameOf(id); exposes `error`
  invites/
    InvitesProvider.tsx       incoming/outgoing pending + last-10-resolved subscription; reads as
                              the effective member (acting-as aware); exposes `error`
    useInvites.ts
  notifications/
    NotificationsProvider.tsx newest-50 notifications subscription (always the signed-in admin's
                              own, never the acted-on member's); unread count; exposes `error`
    useNotifications.ts
  visitors/
    VisitorsProvider.tsx      subscribes to the effective member's own visitors (acting-as aware);
                              exposes `error`
    useVisitors.ts
  teams/
    TeamsProvider.tsx         subscribes to every forming/active team (club-scale); `myTeamForSeries`
                              is acting-as aware; exposes `error`
    useTeams.ts                teamsForSeries(seriesId) / myTeamForSeries(seriesId) / teamById(id)
  lib/
    format.ts                 formatDateNZ/formatTimeOfDay/formatDateTimeNZ/shortWeekdayLabel
    roster.ts                 pure session-roster grouping (pairs/LFP/available/own entry)
    programmeView.ts          pure weekday-timeline grouping + default-tab logic
    card.ts                   pure My Dance Card grouping + per-status line text (+ Team badge)
    sessionActions.ts         pure session-page action state machine (incl. substitute/Teams branches)
    team.ts                   pure team-panel helpers: status label, fullness, per-session absences/subs
    actionErrors.ts           shared member-facing callable-error -> display copy mapping
    memberPicker.ts           pure member-search filter (excludes self + already-confirmed)
  screens/
    SignInScreen.tsx, HomeScreen.tsx (My Dance Card, acting-as aware), ProfileScreen.tsx,
    VisitorsScreen.tsx, NotActiveScreen.tsx, NotificationPrefsForm.tsx, PasswordSection.tsx,
    ProgrammeScreen.tsx, SessionScreen.tsx (roster + actions + substitutes/visitors/Team panel,
    all acting-as aware, incl. an admin-only "force" checkbox on cancel/claim while acting on
    behalf), InvitesScreen.tsx (incl. team invite/captaincy labels), NotificationsScreen.tsx,
    admin/MembersScreen.tsx (Members/Import CSV tabs), admin/MembersTable.tsx (search/filter,
    role/deactivate/reactivate/erase/act-on-behalf dialogs), admin/MembersImportScreen.tsx,
    admin/ProgrammeImportScreen.tsx, admin/AdminProgrammeList.tsx, admin/ProgrammeEditor.tsx
    (series/session list with live sign-up counts), admin/SeriesEditDialog.tsx,
    admin/SessionEditDialog.tsx, admin/BroadcastScreen.tsx, admin/AuditLogScreen.tsx,
    admin/IntegrityScreen.tsx
```

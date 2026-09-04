# Ops runbook

## Environments

| Env | Firebase project | Notes |
|---|---|---|
| local | `demo-obc` | Emulator only. No real project; `demo-*` disables all cloud calls. |
| dev | `obc-dance-card-dev` | Optional shared sandbox. |
| prod | `obc-dance-card` | Blaze plan. Billing budget alert set at NZ$5. |

Copy `firebase/.firebaserc.example` to `firebase/.firebaserc` and fill in the real
project ids. Copy `firebase/functions/.env.example` to `.env` for local runs.

## First-time setup (prod)

1. Create the Firebase project; upgrade to **Blaze**; set a **budget alert**
   (see "Backups and disaster recovery" below for the exact `gcloud` command).
2. Enable **Authentication** → Email/Password provider. In **Authentication →
   Settings**: turn on "Email enumeration protection" and set a password
   policy (min length 8, require ≥1 letter + ≥1 number) — see
   `docs/security-checklist.md` items 2–3 for the exact click-path and a
   script (`check-auth-config.ts`) that verifies both are on.
3. Enable **Identity Platform** (required for the sign-in blocking function).
4. Set `ENFORCE_APP_CHECK=true` in `firebase/functions/.env.<projectId>`
   (e.g. `.env.obc-dance-card`) — **not** in the shared `.env`/`.env.example`
   — and configure App Check providers (reCAPTCHA Enterprise for web, App
   Attest for iOS) and Firestore enforcement in the **App Check** console tab
   before the first production deploy.
5. `npm run deploy:rules` / `npm run deploy:functions` / `npm run
   deploy:hosting` (or `npm run deploy` for all three, in that order) from the
   repo root, with `FIREBASE_PROJECT=<alias>` set to the `.firebaserc` alias
   for this project (`default` for `obc-dance-card`, `dev` for
   `obc-dance-card-dev`). These wrap `firebase --config firebase/firebase.json
   --project <alias> deploy --only ...`; hosting's `predeploy` hook builds
   `@obc/shared` then `web` automatically.
6. Configure email: set `EMAIL_PROVIDER` + credentials as Firebase Secrets
   (`firebase functions:secrets:set ...`). For the zero-cost option, install the
   **Trigger Email from Firestore** extension pointed at the club's Google
   Workspace SMTP.
7. Import members (`importMembers` callable via the admin UI). This creates
   every member as a plain `member` — there is no admin yet to call
   `setMemberRole`. Bootstrap the first admin with a service account instead
   of a manual console edit, so it is repeatable and auditable
   (plan §19; writes a `role_changed` audit-log row with
   `actorMemberId: 'bootstrap-script'`):

   ```sh
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
     npx tsx firebase/scripts/make-admin.ts --email admin@orewabridgeclub.org.nz --project obc-dance-card
   ```

   The script refuses to run against a `demo-*` project (unless `--allow-demo`
   is passed — only useful for smoke-testing the script itself against the
   emulator) and is idempotent: re-running it against an existing admin
   reports "already an admin" and makes no change. Manage every admin after
   the first one in-app via `setMemberRole`.
8. Import the programme CSVs (`importProgramme`), review, `publishProgramme`.

## App-Store-review cohort partition (decided 2026-09-05, plan §2/§8.1)

**Deployment order — read this before deploying the cohort partition to an
existing project.** `firestore.rules`' `members`/`entries`/`teams` reads now
require `resource.data.cohort` to exist and match the caller's own — a doc
still missing that field compares `undefined == 'club'` and fails closed.
The order MUST be:

1. Deploy functions first (`npm run deploy:functions`) — every callable that
   writes a member/entry/team doc now stamps `cohort` server-side, so new
   writes are safe as soon as this lands, even before the backfill/rules
   steps below.
2. Run `firebase/scripts/backfill-cohort.ts` against the target project —
   stamps `cohort: 'club'` onto every pre-existing `members`/`entries`/`teams`
   doc (safe: a pre-partition project has no `review` members, so every
   existing doc is unambiguously `'club'`):
   ```sh
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
     npx tsx firebase/scripts/backfill-cohort.ts --project obc-dance-card
   ```
   Run with `--dry-run` first to preview counts. Idempotent — safe to re-run.
3. **Only then** deploy `firestore.rules` (`npm run deploy:rules`). Deploying
   the rules before steps 1–2 have completed would deny every non-admin,
   non-self read of any doc still missing `cohort`.
4. **iOS handoff** (do not skip): the native app talks to Firestore directly
   (no callable-shaped REST layer to gate this centrally), and
   `ios/OBCDanceCard/App/Stores.swift` has two queries that read the same
   collections the new rules now scope by cohort but do **not** filter on it:
   - `MembersStore` (~line 220): `db.collection(Paths.members).whereField("active", isEqualTo: true)`
   - `TeamsStore` (~line 465): `db.collection(Paths.teams).whereField("status", in: [...])`
   Both will start failing outright (`permission-denied`) for a non-admin
   the moment the rules deploy, because Firestore requires a security rule to
   be provable from the query's own `where()` clauses — an unfiltered query
   cannot be proven safe once the rule depends on `resource.data.cohort`. The
   fix mirrors what `web/src/members/MembersDirectoryProvider.tsx` and
   `web/src/teams/TeamsProvider.tsx` already do: add
   `.whereField("cohort", isEqualTo: <the signed-in member's own cohort>)` to
   both queries, sourced from the already-subscribed own-member doc. (The
   third cohort-scoped collection, `entries`, is untouched on iOS — its one
   query there, `EntriesStore` ~line 576, is already `memberId == uid`
   ownership-scoped, which the rules' ownership disjunct keeps working with
   no cohort filter at all — same reasoning as web's `useMyEntries`.) Ship
   this iOS change (or at minimum confirm iOS has no App-Store-review build
   in flight) **before** step 3, or those two screens go blank for every
   signed-in member on the App Store build until the next release.
5. Provision the review accounts an Apple reviewer will actually use:
   ```sh
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
     npx tsx firebase/scripts/provision-review-cohort.ts \
       --project obc-dance-card --domain reviewer.orewabridgeclub.org.nz \
       --password <a strong password, chosen fresh each window — never reused, never committed>
   ```
   Idempotent (re-running updates password/active state). Hand the reviewer
   the printed `reviewer1@...`/`reviewer2@...` emails and the password you
   just typed — nothing else records it.
6. **Outside a review window**, deactivate the whole cohort (never deletes —
   same "keep the row, flip active" convention as `deactivateMember`):
   ```sh
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
     npx tsx firebase/scripts/provision-review-cohort.ts --project obc-dance-card --deactivate
   ```
   Re-running step 5 (without `--deactivate`) reactivates and re-provisions
   for the next window.

## Deploy notes learned on the first production deploy (2026-08-30)

- **Functions are deployed as an esbuild bundle.** `firebase.json` points
  `functions.source` at `firebase/functions-deploy/`, generated by the predeploy
  hook (`npm --prefix functions run bundle`). Cloud Build cannot install the
  workspace package `@obc/shared` (npm E404), so it is inlined. Never edit
  `functions-deploy/` by hand; it is gitignored and rebuilt on every deploy and
  by `npm run emulators`.
- **Secrets must not appear in any `.env*` file**, even as empty keys — Cloud Run
  rejects a plain env var that overlaps a bound secret ("Secret environment
  variable overlaps non secret environment variable").
- **Single-field composite indexes are rejected** by production Firestore (the
  emulator accepts them). `firestore.indexes.json` must only contain multi-field
  indexes.
- **Public invoker on HTTPS functions.** If the CLI's IAM step fails on a brand-new
  project (service agents not yet propagated), the callables deploy but return
  Cloud Run's HTML 403. Re-running the deploy fixes newly *created* functions
  only; for the rest, grant `roles/run.invoker` to `allUsers` on each callable and
  blocking function (Cloud Run console → service → Security → "Allow
  unauthenticated", or the Cloud Run API). Triggers and scheduled jobs stay
  private. `icalFeed` (plan §21 B1) needs this too — it's a plain HTTP
  `onRequest` function, not a callable, but the same Cloud Run "no public
  invoker yet" failure mode applies to it identically; the orchestrator
  applies this grant post-deploy alongside the callables.
- **Custom-token sign-in needs two extra grants** that no deploy step applies:
  enable the **IAM Service Account Credentials API** (`iamcredentials.googleapis.com`),
  and grant `roles/iam.serviceAccountTokenCreator` to the functions' runtime
  service account (`<project-number>-compute@developer.gserviceaccount.com`)
  **on itself** (a service-account-level binding, not project-level). Without
  them `verifyLoginCode` fails at `createCustomToken` with
  "Permission 'iam.serviceAccounts.signBlob' denied" and members see
  "Something went wrong" after entering a correct code.
- **Hosting `public` must live inside `firebase/`**: the predeploy copies
  `web/dist` to `firebase/web-dist/` (gitignored).

## Local development

```sh
npm install
npm run build -w @obc/shared          # once, and after changing shared types
npm run emulators                      # Firestore + Auth + Functions + UI
npm run seed -w @obc/functions         # sample data
npm run dev -w web
```

Java 11+ must be on PATH for the emulator suite (`mise use -g java@temurin-21`
or the distro package).

## Cost watch

- Firebase itself should stay at $0 at club scale; the budget alert is the
  backstop.
- `maxInstances` for functions is pinned low in `src/index.ts`.
- The only recurring cost is transactional email if it exceeds the provider free
  tier; the Workspace-SMTP route avoids it.

## Common tasks

- **Add/adjust an admin:** `setMemberRole` callable (admin-only), used from the
  admin UI once at least one admin exists. For the very first admin on a new
  project (no admin exists yet to call it), use
  `firebase/scripts/make-admin.ts` — see step 7 above. Never set `role`
  directly in the Firestore console: rules deny all client writes to
  `members` regardless of who is signed in, so a console edit would only be
  possible via the project owner's Firestore *admin* access (bypassing rules
  entirely) and would skip the refresh-token revocation and audit-log entry
  the callable/script both do.
- **A member changed email:** update the row and re-run `importMembers`; the old
  address stops working, the new one starts. Their card is keyed on uid, so it
  survives if the uid is unchanged — for an email change, the member re-links on
  next login. (Detailed procedure TBD in Phase 1.)
- **Suspected split pairing:** run `runPairingSweep` (below) — it reports and
  optionally repairs one-sided/mismatched entries and I9 team mismatches, and
  writes to `auditLog`.

## Last-admin guard

`setMemberRole` and `deactivateMember` both refuse an action that would leave
the club with **zero active admins** — whether the caller is demoting/
deactivating themselves or someone else. The check counts every
`members` doc with `role == 'admin' && active == true`, excluding the target
of the action; if that count is zero, the call fails with
`failed-precondition`. To hand off to a successor admin, always **promote the
new admin first**, then demote/deactivate the outgoing one — never the other
way round, or the second step will be refused. There is no override for this
guard (not even `force`); the only way around it from ops is the console
script noted in plan §19 (`firebase/scripts/make-admin.ts`), used sparingly
and always followed by an audit-log review.

## Member erasure (`eraseMember`)

Per the NZ Privacy Act 2020 purpose-limitation principle (plan §8.1 "Privacy
law"), a departed member's personal data can be scrubbed on request, but only
once retention needs are clearly past:

1. `deactivateMember` first (this also frees future pairings/teams and
   expires their pending invites). Note the date — `deactivatedAt` is stamped
   automatically on the member doc.
2. Wait **at least 30 days** from `deactivatedAt`. `eraseMember` refuses
   (`failed-precondition`) before that, and also refuses if the member is
   still active or if `deactivatedAt` was never recorded (an old member
   deactivated before this field existed needs a manual
   `deactivatedAt` backfill, or simply `reactivateMember` +
   `deactivateMember` again to stamp a fresh one).
3. Call `eraseMember({ memberId, confirmName })` where `confirmName` must
   equal the member's **current** `"${firstName} ${lastName}"` exactly — this
   is a confirmation step, not a lookup, so double-check the name shown in
   the admin UI immediately before calling.
4. What it does: `members/{uid}` → name → "Former Member", phone cleared,
   `erasedAt` stamped; `memberPrivate/{uid}` → email replaced with
   `erased-{uid}@erased.invalid`, devices/prefs reset; every `visitors` doc
   they created is deleted; every entry (any date, including history) whose
   `partner`/`substitute`/`partnerSubstitute` names them has that
   denormalised name replaced with "Former member" (the `memberId` is kept —
   card history is never deleted); every `teams.members[]` ref naming them is
   renamed the same way; their notifications are deleted; the Firebase Auth
   account is deleted outright. `auditLog` rows are **not** touched — they
   retain the uid for the full 2-year retention window (plan §8.1), and the
   `member_erased` audit entry itself carries no PII in `before`/`after`.
5. This is irreversible (the Auth account is gone, so the member can never
   sign in again under that identity even if re-imported later — a
   re-import creates a **new** uid).

## Integrity sweep (`runPairingSweep` / `verifyPairingConsistency`)

- **Scheduled:** `verifyPairingConsistency` runs nightly at 03:00
  `Pacific/Auckland`. It checks every entry dated today-or-later
  (`validatePairingGroup`, grouped by session) and every non-disbanded team
  with a future session (`validateTeamGroup`), and writes a report to
  `integrity/{runId}` (server-only; not readable by clients, not even
  admins — there is deliberately no `listIntegrityRuns` callable in this
  phase, only the Cloud Functions log line `pairing_sweep_done` and, when a
  repair fires, an `auditLog` row per repaired document).
- **Repair flag:** the scheduled job only *repairs* when the function's
  environment has `PAIRING_SWEEP_REPAIR=true` set (Secret Manager / function
  config — **not** committed to `.env.example`). Leave it unset (or `false`)
  in normal operation so the nightly job is detect-and-log only; flip it on
  temporarily via `firebase functions:config:set` / the Console's env var
  editor for a deployment cycle if a known corruption needs the automated fix
  applied club-wide, then flip it back off.
- **On-demand / manual repair:** an admin can call the deployed
  `runPairingSweep` callable directly (`{ repair: true }`) from the admin UI
  or `curl`/console at any time — this does not depend on the environment
  flag above (it always does exactly what `repair` says), and every repair it
  makes is audited under the calling admin's uid rather than `'system'`.
- **What gets auto-repaired** (conservative, deterministic; anything else is
  reported only, never touched): a pairing where one side is confirmed with a
  member partner whose mirror is missing, cancelled, or references a
  different `pairingId` → that side is reverted to "looking for a partner"
  and the member is notified; stray substitution fields left on an otherwise
  valid pairing → cleared silently; a team roster member missing their entry
  on a future session → a `confirmed` entry is created for them; a
  non-rostered member's leftover entry on a team session → cancelled.
- **After a repair run**, spot-check `auditLog` for `action == 'pairing_repair'`
  entries from the run's time window before assuming everything is fine —
  the sweep never blocks or crashes on a shape it doesn't recognise, it just
  leaves it in the report for a human to look at.

## Backups and disaster recovery

Plan §8.1 "Backups" / §18 checklist items 11–12. All commands below need the
`gcloud` CLI authenticated against the target project
(`gcloud config set project <projectId>`, or pass `--project` explicitly).

### Daily backups (30-day retention)

```sh
gcloud firestore backups schedules create \
  --database='(default)' \
  --recurrence=daily \
  --retention=30d \
  --project=obc-dance-card
```

Repeat for `obc-dance-card-dev` if the dev project holds anything worth
protecting. List existing schedules with:

```sh
gcloud firestore backups schedules list --database='(default)' --project=obc-dance-card
```

Point-in-time recovery (PITR) is a separate, complementary setting — it lets
you restore to any point in the last 1–7 days rather than only to a daily
snapshot. Enable it once per database if the extra cost (storage for the
change log) is acceptable at club scale:

```sh
gcloud firestore databases update --database='(default)' \
  --point-in-time-recovery --project=obc-dance-card
```

### Restore rehearsal (do this once, in the dev project, before pilot)

Restoring **always creates a new database** — it never overwrites the
source — so this is safe to rehearse without touching live data:

```sh
# 1. List available backups for the dev project.
gcloud firestore backups list --project=obc-dance-card-dev

# 2. Restore the most recent one into a fresh database in the same project.
gcloud firestore databases restore \
  --source-backup=<BACKUP_NAME_FROM_STEP_1> \
  --destination-database='restore-rehearsal' \
  --project=obc-dance-card-dev

# 3. Point a local emulator-free sanity check at it (Firebase console →
#    Firestore → switch database selector to "restore-rehearsal") and spot
#    check a few `members`/`entries` docs look right.

# 4. Clean up — restores are billed like any other database.
gcloud firestore databases delete --database='restore-rehearsal' \
  --project=obc-dance-card-dev
```

Record the date of the last rehearsal in this file (or a note in the team's
tracker) so "restore rehearsed once in the dev project" (checklist item 11)
has a timestamp, not just a checkbox.

### Budget alert

```sh
# Find the billing account linked to the project first:
gcloud billing projects describe obc-dance-card --format='value(billingAccountName)'

gcloud billing budgets create \
  --billing-account=<BILLING_ACCOUNT_ID> \
  --display-name="OBC Dance Card — NZ$5 alert" \
  --budget-amount=5NZD \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=1.0 \
  --threshold-rule=percent=1.5 \
  --filter-projects=projects/obc-dance-card
```

This is the console-equivalent of **Billing → Budgets & alerts → Create
budget**, scoped to the one project, alerting at 50/100/150% of NZ$5/month —
comfortably below what club-scale usage should ever reach (see "Cost watch"
above), so any alert firing is a signal something is actually wrong (a
runaway function, a misconfigured `maxInstances`, etc.), not routine.

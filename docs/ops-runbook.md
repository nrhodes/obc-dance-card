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

1. Create the Firebase project; upgrade to **Blaze**; set a **budget alert**.
2. Enable **Authentication** → Email/Password provider.
3. Enable **Identity Platform** (required for the sign-in blocking function).
4. `firebase deploy --only firestore:rules,firestore:indexes,functions`
5. Configure email: set `EMAIL_PROVIDER` + credentials as Firebase Secrets
   (`firebase functions:secrets:set ...`). For the zero-cost option, install the
   **Trigger Email from Firestore** extension pointed at the club's Google
   Workspace SMTP.
6. Import members (`importMembers` callable via the admin UI) — this also
   provisions the first admin: set one member's `role` to `admin` directly in the
   console, then manage the rest in-app.
7. Import the programme CSVs (`importProgramme`), review, `publishProgramme`.

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

- **Add/adjust an admin:** `setMemberRole` callable (admin-only) or the console.
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

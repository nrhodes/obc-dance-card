# Pilot runbook (Phase 7)

Plan §16 Phase 7 ("one-weekday pilot") and §17 verification. This is the
day-to-day operating plan for running the app alongside the paper booklet
for a single weekday's sessions before opening it to the whole club. It
assumes `docs/ops-runbook.md`'s "First-time setup (prod)" has already been
done once for the real project (`obc-dance-card` or `obc-dance-card-dev`,
whichever the club decides to pilot against) and `docs/security-checklist.md`
is signed off.

## Choosing the pilot weekday

Pick the weekday with the most engaged Partner Steward and the smallest
membership overlap with the other weekdays (so a bug affecting the pilot
group's data can't spill into sessions nobody is testing yet). Mon/Wed/Fri
1pm, Tue juniors 7pm, and Thu 7pm are the plan's five weekday programmes
(plan §1) — any one of them works; the runbook below doesn't assume which.

## Pre-flight (do all of this before telling members the app is live)

1. **Security checklist** (`docs/security-checklist.md`): every `console`
   item done for this project, every `code` item green in CI for the commit
   being deployed.
2. **`check-auth-config.ts`**: `GOOGLE_APPLICATION_CREDENTIALS=./key.json npx
   tsx firebase/scripts/check-auth-config.ts --project <projectId>` exits 0
   (email enumeration protection + password policy both on).
3. **First admin**: `firebase/scripts/make-admin.ts` has been run for at
   least one real admin email (`docs/ops-runbook.md` step 7) — confirm by
   signing in as them and seeing the Admin nav section.
4. **Import members**: `importMembers` with the pilot weekday's members (or
   the whole club, if the club prefers one CSV — deactivation only ever
   affects members *absent* from the file, so importing the whole roster
   even for a one-weekday pilot is safe and simpler). Review the dry-run
   report before the real import; confirm the counts (added/updated/
   deactivated) match expectations.
5. **Import + publish the programme**: `importProgramme` (weekdays, series,
   singles CSVs) for the pilot weekday(s) at minimum, dry-run reviewed, then
   `publishProgramme`. Members see nothing until this step.
6. **Budget alert**: confirmed set (`docs/ops-runbook.md` "Budget alert") —
   `gcloud billing budgets list --billing-account=<ACCOUNT_ID>` shows the
   NZ$5 alert for this project.
7. **Backups**: daily backup schedule created (`docs/ops-runbook.md`
   "Backups and disaster recovery") and the one-time restore rehearsal done
   in the dev project, with its date recorded there.
8. **Bundle/CSP/a11y**: `npm run build -w web` reports the initial JS under
   400 kB gzipped (task deliverable E; see the Phase 7b report for the
   actual number); `npx playwright test e2e/a11y.spec.ts` green against this
   build's deploy target.

## The paper-backup arrangement

For the whole pilot period, **the paper booklet stays the source of truth
for anyone not using the app**. Practically:

- The Partner Steward keeps writing down partnerships on their own paper
  copy exactly as before, for pilot members and non-pilot members alike —
  the app supplements their phone-based matchmaking, it doesn't yet replace
  it.
- Print one extra paper card for each pilot member, marked "pilot — app
  copy," so if the app is unavailable on the day (venue wifi down, a device
  problem) the session still runs off paper with no scramble.
- At the end of each pilot session, the Partner Steward (or another
  volunteer) does a two-minute cross-check: does the app's roster for that
  session match who actually showed up paired? Note any mismatch in the
  daily-watch log below — this is the cheapest signal for a real bug versus
  a member simply not using the app correctly yet.

## Partner Steward briefing

Before the first pilot session, walk the weekday's Partner Steward through:

- Their own sign-in (code, and optionally setting a password from Profile).
- `/programme` → their weekday → a session, and what the roster/noticeboard
  ("Looking for a partner" / "Available") looks like from a member's view —
  they'll be fielding phone calls from members who "can't find the button."
- **They cannot act on a member's behalf** — only admins can (plan §2); if a
  member needs help doing something in the app rather than over the phone,
  the Partner Steward calls an admin, who uses **Admin: Members → Act on
  behalf** (audit-logged, and the member is notified either way).
- `/help` (task deliverable H) is the page to point members at first —
  install-as-app, turning on notifications, "Looking for a partner" vs
  "Available", cancelling. Most phone calls should be answerable with "have
  you looked at Help?"
- How to reach the on-call admin (see below) if something looks structurally
  wrong (a roster showing someone who cancelled, a session missing).

## What to watch daily during the pilot

An admin checks these once a day for the pilot's duration:

- **Admin: Audit log** — skim for anything unexpected (unrecognised
  on-behalf actions, deactivations nobody requested).
- **Admin: Integrity → Run check** — should report 0 violations every day;
  if not, read the violation list, then **Run check and repair** and note
  the repair in the audit log follow-up.
- **Notification failures** — the pilot project's Cloud Functions logs
  (`firebase functions:log --project <projectId>` or the console) for
  `notification_dispatched` entries and any error-level log from
  `dispatch.ts`/`scheduled.ts`; a member reporting "I didn't get notified"
  is the first sign something's wrong here.
- **The paper cross-check log** from the Partner Steward (above).
- **Budget** — a quick glance at the billing console; nothing here should
  move at club scale (plan §8.1), so any movement at all is worth
  understanding before it becomes a habit.

## Exit criteria

The pilot is ready to widen to the next weekday (or the whole club) when,
over at least two consecutive pilot sessions:

- Zero integrity-sweep violations were found (or every one found was
  understood and repaired the same day).
- Zero data-loss or wrong-pairing incidents surfaced by the paper
  cross-check.
- No security-checklist item regressed (re-run the automated ones from CI on
  the deployed commit).
- The Partner Steward reports members can complete "look at who's playing,"
  "invite/claim a partner," and "cancel" without a phone call, at least as
  often as not.
- No `console.error`/PII leak found in a log grep after the pilot sessions
  (`docs/security-checklist.md` item 9's manual step).

If those hold, repeat pre-flight for the next weekday and widen; if they
don't, fix and re-run at least one more full pilot session before widening.

## Rollback: "revert to paper"

There is no partial rollback of programme data — the app's published
programme and the paper booklet are meant to describe the same sessions, so
"rolling back" means **members stop being told to use the app**, not that
data is deleted or the programme is unpublished. Unpublishing would only
confuse members who already have entries recorded; leave the programme
published and simply stop relying on the app operationally.

1. Tell the pilot weekday's members (in person / by phone via the Partner
   Steward, not by relying on an in-app broadcast they may not see) that the
   club is reverting to the paper card for now.
2. The Partner Steward's paper copy (kept live throughout the pilot per
   "paper-backup arrangement" above) is already the fallback — no data
   entry catch-up is needed.
3. Leave the deployed app running (members who did sign in can still see
   their card; nothing forces them to stop), unless the reason for
   reverting is a **security** concern (see emergency stop, next).

## Emergency stop: disable sign-in for everyone

Out of scope (per the task brief) is adding a `SIGNIN_DISABLED` env flag to
`beforeSignIn` — that's a code change requiring a deploy, too slow for an
actual emergency. Instead, use the control the app already has, which takes
effect within one token refresh (plan §8.2) and needs no deploy:

**Run a members import that deactivates everyone**, using
`allowMassDeactivation: true`:

1. Prepare (or reuse) a `members.csv` containing **zero** rows (or only the
   admin(s) who need continued access to fix things) — every member present
   in `members/` but absent from this file is deactivated
   (`docs/ops-runbook.md`; `firebase/functions/src/admin/importMembers.ts`).
2. In **Admin: Members → Import CSV**, upload it. The import normally
   refuses a mass deactivation above its threshold ("No one was
   deactivated. If this is intended, re-run with `allowMassDeactivation:
   true`.") — tick the **allow mass deactivation** checkbox the UI shows
   when it detects this, or pass `allowMassDeactivation: true` directly if
   calling the function another way.
3. Every deactivated member's refresh tokens are revoked immediately
   (`auth.revokeRefreshTokens`) and `beforeSignIn` denies their next sign-in
   attempt — active sessions lose Firestore/callable access on their very
   next request (rules re-`get()` the caller's `active` flag every time),
   and nobody can sign back in until reversed.
4. **To reverse**: re-import the real, full members CSV — every previously
   active member is reactivated and can sign in again on their next attempt.
   This does not need `allowMassDeactivation` (reactivating isn't the
   guarded path).
5. Follow up: check **Admin: Audit log** for the `member_import` entries
   from both the stop and the reversal, and record what triggered the
   emergency stop and how it was resolved.

This is deliberately blunt (it is, after all, the emergency stop) — for
anything short of "we need everyone locked out right now," prefer targeted
action instead: deactivate a single member from **Admin: Members**, or fix
the root cause and leave sign-in open.

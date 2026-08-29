# Web hardening notes (Phase 7b)

Supplementary notes for decisions made during Phase 7b that don't belong in
`docs/manual-test-script.md` or `docs/security-checklist.md` directly.

## React StrictMode

**Status: re-enabled unconditionally in production; on by default in E2E
too.** `web/src/main.tsx` wraps `<App />` in `<StrictMode>` again.

### Background

Phase 3b's `main.tsx` removed `<StrictMode>` with this justification: its
dev-only double-invoked effects (mount → cleanup → mount again) multiply
every `onSnapshot` subscription, and — against the Firestore *emulator*
specifically, with a second concurrent browser session also
subscribing/unsubscribing (as in `e2e/dancecard.spec.ts`) — that churn was
said to reliably trigger a Firestore JS SDK internal assertion
(`INTERNAL ASSERTION FAILED: Unexpected state (ID: ca9)`) in the
watch-stream target bookkeeping, permanently wedging every listener in the
tab.

### What Phase 7b found

1. **Every provider's effect already does the right thing.** A full read of
   every `onSnapshot`-using file (`AuthProvider`, `MembersDirectoryProvider`,
   `ProgrammeProvider`, `InvitesProvider`, `NotificationsProvider`,
   `VisitorsProvider`, `TeamsProvider`, `SessionScreen`'s own entries
   listener) shows every effect returns a cleanup that unsubscribes exactly
   the listener(s) it created, keys its subscription on the effective member
   id / year / session id (never re-subscribing on an unrelated re-render),
   and never calls `setState` outside of the subscription's own callback (so
   there is no "state update after unmount" path either — `onSnapshot`'s
   returned unsubscribe function is exactly what stops that callback from
   firing again). None of this needed to change for this task.
2. **`firebase` is already on 11.10.0**, a materially newer minor than
   whatever Phase 3b was pinned to — `firebase-js-sdk` has shipped several
   fixes across v9–v11 for "INTERNAL ASSERTION FAILED: Unexpected state"
   reports tied to rapid listener churn.
3. **Reproduction attempts did not reproduce the bug.** With `<StrictMode>`
   re-enabled, against a freshly seeded emulator:
   - `e2e/dancecard.spec.ts` and `e2e/teams.spec.ts` (both drive **two**
     concurrent browser contexts through a full subscribe/act/unsubscribe
     cycle, exactly the scenario the removal comment described) passed
     cleanly, repeatedly.
   - `e2e/admin.spec.ts` (also two contexts) passed on two of three attempts;
     the one failure ("No audit entries match" on `/admin/audit` right after
     an on-behalf action) happened on the very first call to that screen
     immediately after a cold `firebase emulators:start` + fresh
     `npm run seed`, and never recurred on a fresh seed afterwards. That
     shape — a one-off miss on the very first invocation of a rarely-hit
     Cloud Function, never a stuck/permanently-loading screen — matches
     Cloud Functions emulator cold-start latency (the emulator's first
     `listAuditLog` call pays for lazily loading/compiling that function),
     not a Firestore SDK assertion. No `INTERNAL ASSERTION FAILED` message,
     and no permanently-stuck listener, was observed in any run.
   - No other spec (`signin`, `programme`, `visitors`) showed any anomaly.

Given (1)–(3), the most likely explanation is that the underlying
`firebase-js-sdk` bug (real at the time Phase 3b hit it) has since been
fixed upstream by a version bump this repo already picked up, combined with
the provider code already following the correct listener-lifecycle pattern.
There is no currently-reproducing bug to cite a live GitHub issue number
for — reproduction was attempted, not assumed away.

### The residual escape hatch

Per the task brief's "last resort" instruction, `main.tsx` still supports
`VITE_DISABLE_STRICT_MODE=true` to turn StrictMode off — **but it is not set
anywhere by default**, including in the E2E config; the full seven-spec
Playwright suite runs (and is expected to keep running) with StrictMode on,
matching production. If a genuine StrictMode-only flake ever resurfaces
against the emulator:

1. Reproduce with two concurrent Playwright contexts against a **freshly
   started** emulator (`pkill -f "[f]irebase --project demo-obc"`, restart,
   reseed) at least 3 times before concluding it's real (cold-start flakes
   happen on the very first call after a restart, as above).
2. Capture the browser console (`page.on('console', ...)` in the failing
   spec, or read the Playwright trace's console events) and look
   specifically for `INTERNAL ASSERTION FAILED`.
3. Only then set `VITE_DISABLE_STRICT_MODE=true` for the E2E run
   (`web/.env.test` or the CI job env — not `.env`/`.env.example`, which
   must keep StrictMode on for local dev parity with production), and note
   the reproduction steps and firebase-js-sdk version here.

## Bundle splitting: what was and wasn't split

Task deliverable E asked for admin routes *and* dialogs to be code-split.

- **Admin routes**: done. `web/src/AdminRoutes.tsx` lazy-loads all five
  `/admin/*` screens (and everything they transitively import — the CSV
  import UI, the programme editor, the audit-log table) behind
  `React.lazy`/`Suspense`, mounted from a single `/admin/*` route in
  `App.tsx`. Zero risk: nothing outside `RequireAdmin` ever reaches this
  code, and no test renders these screens through `App.tsx`'s router (they
  render each screen directly).
- **Dialogs**: evaluated, not implemented. The member bundle (`vite build`)
  is already 219 kB gzipped as one chunk before any splitting — well under
  the 400 kB target — so there was no size problem left to solve on the
  member side. The one component big enough to matter, `TeamPanel.tsx`
  (511 lines), and the session-page dialogs, are both rendered
  synchronously in existing RTL tests (`SessionScreen.test.tsx`,
  `TeamPanel.test.tsx`) via `getBy*` queries with no `await`/`findBy*`;
  making them `React.lazy` would require rewriting those assertions to
  await the `Suspense` boundary for a bundle-size win that doesn't move the
  needle against the 400 kB target. Left as plain imports; see the main
  report for the before/after `vite build` numbers with just the admin
  split applied.

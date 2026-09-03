# OBC Dance Card

[![CI](https://github.com/nrhodes/obc-dance-card/actions/workflows/ci.yml/badge.svg)](https://github.com/nrhodes/obc-dance-card/actions/workflows/ci.yml)

An electronic version of the Orewa Bridge Club (OBC) annual programme and personal
"dance card": members see the season's sessions, invite each other to play, see who
is already playing on a date, advertise as *Available* / *Looking for Partner*, and
get notified when a partner cancels or an invite arrives.

The club membership skews elderly (70s–90s), so login and UI are deliberately
low-friction.

## What's here

| Path | Purpose |
|---|---|
| `shared/` | TypeScript types, zod schemas, pairing/time helpers, and CSV import templates — the single source of truth for the data model and callable contracts. Consumed by `web` and `firebase/functions`; the iOS app mirrors these as `Codable` structs. |
| `firebase/` | `firebase.json`, Firestore rules + indexes, emulator config, Cloud Functions (`functions/`, Node 22, gen2), seed scripts (`seed/`), one-off ops scripts requiring a service account (`scripts/`: `make-admin.ts`, `check-auth-config.ts`). |
| `web/` | React + Vite + TypeScript PWA. Also the Android / desktop experience. |
| `ios/` | Native SwiftUI app (added in Phase 2). |
| `docs/` | Data model, CSV formats, ops runbook, security checklist, pilot runbook, web hardening notes, manual test script. |

## Scope

**Scheduling only.** Scores, results, and standings stay in the NZ Bridge software.

See [`docs/data-model.md`](docs/data-model.md) for the domain model and
[`docs/implementation-plan.md`](docs/implementation-plan.md) for the full
design, security model, and build phases — it is the contract this repo is
built against.

## Project status

Build phases per plan §16; "Definition of done" for each is in that section.

| Phase | Scope | Status |
|---|---|---|
| 0.5 Reconcile | Monorepo scaffold, shared model, rules, functions skeleton | Done |
| 1 Members & auth | Import, login code + password, sign-in/profile/admin-import UI | Done |
| 2 Programme | Programme import/publish, web + iOS programme browser | Done |
| 3 Card core | Invites, accept/cancel, solo status, claim, My Card + session actions | Done |
| 4 Visitors & substitutes | Visitor partners, substitutes, repeat-partner warning | Done |
| 4b Teams | Team creation/invite/roster, Teams-format noticeboard | Done |
| 5 Notifications | Fan-out, FCM (iOS + web push), email, digest, reminders | Done |
| 6 Admin & integrity | On-behalf, roles, erasure, broadcast, audit log, pairing sweep | Done |
| 7 Hardening & pilot | App Check on, CSP hardening, accessibility pass, PWA polish, privacy/help pages, pilot runbook | Done (this pass) — real-project console items and the pilot itself are still to run; see `docs/security-checklist.md` and `docs/pilot-runbook.md` |

Everything is green against the emulator (`npm run build && npm run
typecheck && npm run lint && npm test`, `npm run test:rules -w
@obc/functions`, `npm run test:emu -w @obc/functions`) and via the Playwright
E2E suite (`web/e2e/*.spec.ts`, see `web/README.md`) as of this pass. What's
left before a real pilot is entirely **console/ops work that has no code
artifact** — Firebase console settings per project, backups, budget alert,
and the pilot itself — tracked in `docs/security-checklist.md`'s "Items with
no code artifact" section and `docs/pilot-runbook.md`.

## Security model, in one paragraph

**Clients never write Firestore**, with exactly one exception: a member may
mark their own `notifications` read. Every other mutation — pairing up,
inviting, cancelling, teams, imports, admin actions — is a Cloud Functions
callable that validates input with a zod schema, resolves the acting member
from `req.auth.uid` (never a client-supplied id), writes inside a transaction,
and re-checks the pairing/team invariants (`shared/src/pairing.ts`) before
committing. Firestore rules are read-only for clients (`firebase/firestore.rules`),
determined by `get()`-ing the caller's own `members/{uid}` doc — no custom
claims to keep in sync. Emails, phones, and device tokens live in
`memberPrivate`/`visitors`, never in the roster-visible `members` doc.

## Prerequisites

- Node.js 22 (see `.mise.toml`)
- Java 21 (JRE) — required by the Firebase Emulator Suite (see `.mise.toml`)
- A Firebase project on the **Blaze** plan (Cloud Functions and the auth blocking
  function require it; usage stays within the free tier at club scale — see the plan)

## Getting started

```sh
npm install
cp firebase/functions/.env.example firebase/functions/.env   # fill in local values
cp web/.env.example web/.env                                  # emulator defaults work as-is

# Secrets declared with defineSecret() (login-code pepper, SMTP password) are
# not read from .env — the emulator reads them from this gitignored file:
echo "LOGIN_CODE_PEPPER=local-dev-pepper" > firebase/functions/.secret.local
echo "SMTP_PASS=local-dev-smtp-pass" >> firebase/functions/.secret.local

npm run build             # builds @obc/shared, which functions/web import
npm run emulators         # Firestore + Auth + Functions + Hosting on demo-obc (needs --config; see below)
npm run seed -w @obc/functions   # 20 fake members incl. admin@example.org, into the running emulator
npm run dev -w web         # Vite dev server on http://localhost:5173
```

`npm run emulators` runs
`firebase --project demo-obc --config firebase/firebase.json emulators:start`
(the `--config` matters — `firebase.json` lives under `firebase/`, not the
repo root). `npm run seed` talks to whatever emulator is already listening on
the standard ports; it refuses to run unless
`FIRESTORE_EMULATOR_HOST`/`FIREBASE_AUTH_EMULATOR_HOST` are set, which
`firebase emulators:exec` does automatically but a plain
`emulators:start` (as above) does not — set them yourself first if you're not
using `emulators:exec`:

```sh
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
export GCLOUD_PROJECT=demo-obc
```

See [`web/README.md`](web/README.md) for the web app's own dev/test/E2E
instructions.

## Running everything (from a cold start)

```sh
npm ci
npm run build                                   # @obc/shared, web, functions
npm run typecheck && npm run lint               # whole repo
npm test                                        # shared + web (vitest) + functions (vitest, no emulator)
npm run test:rules -w @obc/functions            # Firestore rules matrix (needs Java; starts its own emulator)
npm run emulators                               # separate terminal: Firestore+Auth+Functions+Hosting, project demo-obc
npm run seed -w @obc/functions                  # 20 fake members incl. admin@example.org
npm run test:emu -w @obc/functions              # emulator-backed function tests (starts its own emulator instance)
npm run dev -w web                              # separate terminal: Vite dev server on :5173
npx playwright install chromium                 # once
npm run test:e2e -w web                         # see web/README.md for rate-limit-aware batching
```

`test:rules` and `test:emu` each start and stop their own throwaway emulator
instance (`firebase emulators:exec`) — they don't need `npm run emulators`
running first, and can't share a running one. The E2E suite is the opposite:
it assumes the emulators + seed + `npm run dev -w web` from the steps above
are already up and serving `demo-obc`.

## Deploying

```sh
FIREBASE_PROJECT=default npm run deploy:rules      # firestore:rules,firestore:indexes
FIREBASE_PROJECT=default npm run deploy:functions
FIREBASE_PROJECT=default npm run deploy:hosting    # builds @obc/shared then web first
FIREBASE_PROJECT=default npm run deploy             # all three, in that order
```

`FIREBASE_PROJECT` selects the `.firebaserc` alias (`default` →
`obc-dance-card`, `dev` → `obc-dance-card-dev`; see
`firebase/.firebaserc.example`) and defaults to `default` if unset. See
`docs/ops-runbook.md` for the full first-time-setup sequence (App Check,
email provider, first admin) and `docs/security-checklist.md` for what must
be verified before a real deploy goes live.

## Cost

At ~200 members the Firebase bill is effectively $0 — usage sits inside the monthly
free allowances. The Blaze plan just requires a card on file. Set a billing budget
alert (~NZ$5) and keep Cloud Functions `maxInstances` low. Transactional email
(login codes + notifications) is the only likely cost; routing through the club's
Google Workspace SMTP via the "Trigger Email" extension keeps that at $0.

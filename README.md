# OBC Dance Card

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
| `docs/` | Data model, CSV formats, ops runbook, security checklist, manual test script. |

## Scope

**Scheduling only.** Scores, results, and standings stay in the NZ Bridge software.

See [`docs/data-model.md`](docs/data-model.md) for the domain model and
[`docs/implementation-plan.md`](docs/implementation-plan.md) for the full
design, security model, and build phases — it is the contract this repo is
built against.

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

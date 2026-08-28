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
| `firebase/` | `firebase.json`, Firestore rules + indexes, emulator config, Cloud Functions (`functions/`, Node 22, gen2), seed scripts (`seed/`). |
| `web/` | React + Vite + TypeScript PWA. Also the Android / desktop experience. |
| `ios/` | Native SwiftUI app (added in Phase 2). |
| `docs/` | Data model, CSV formats, ops runbook, manual test script. |

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
npm run emulators        # Firestore + Auth + Functions on localhost
npm run seed             # load a sample programme + fake members into the emulator
npm run --workspace web dev
```

## Cost

At ~200 members the Firebase bill is effectively $0 — usage sits inside the monthly
free allowances. The Blaze plan just requires a card on file. Set a billing budget
alert (~NZ$5) and keep Cloud Functions `maxInstances` low. Transactional email
(login codes + notifications) is the only likely cost; routing through the club's
Google Workspace SMTP via the "Trigger Email" extension keeps that at $0.

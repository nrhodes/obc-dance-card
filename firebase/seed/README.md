# Emulator seed data

`npm run seed -w @obc/functions` (from the repo root), or `npm run seed` from
`firebase/functions`, loads a representative data set into the running emulator so the
apps have something to render during development:

- 20 fake members (a mix of grades; one admin, `admin@example.org`), all `@example.org`
  addresses, provisioned via the exact same code path as `importMembers`
  (`firebase/functions/src/admin/provisionMember.ts`)
- **TODO (Phase 2):** the 2027 programme (weekdays/series/sessions), pairings, and
  invites, once `importProgramme` exists.

The script talks to the Auth + Firestore emulators only. It refuses to run unless
**both** `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST` are set **and** the
resolved project id (`--project`, or `GCLOUD_PROJECT`/`FIREBASE_PROJECT`) starts with
`demo-`, so it can never touch a real project.

## Running it

```sh
npm run build                 # builds @obc/shared, which the functions code imports
npm run emulators &           # starts Firestore + Auth + Functions on demo-obc
npm run seed -w @obc/functions
```

`firebase/functions/package.json` runs the script with `tsx` (`tsx ../seed/seed.ts`) so
it executes the TypeScript source directly under Node 22 ESM, no separate build step.

## Implementation

`firebase/seed/seed.ts` — provisions members by calling `provisionMember` directly
(imported dynamically, after the emulator/project guard has run, since importing it
initialises the Firebase Admin SDK).

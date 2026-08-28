# Emulator seed data

`npm run seed -w @obc/functions` (from the repo root), or `npm run seed` from
`firebase/functions`, loads a representative data set into the running emulator so the
apps have something to render during development:

- 20 fake members (a mix of grades; one admin, `admin@example.org`), all `@example.org`
  addresses, provisioned via the exact same code path as `importMembers`
  (`firebase/functions/src/admin/provisionMember.ts`).
- A **published 2027 programme**, transcribed from the club's printed booklet:
  Monday (13:00/12:45, steward `admin@example.org`) — Marion Taylor Pairs, Campbell
  Cave Pairs, Milton Pairs, Martin Gillam Memorial Mon Champ Pairs (5 from 6, no
  substitute), Summerset Mon Individual (4 from 5), Campbell Cave Teams; Tuesday
  (19:00/18:45, juniors, "No partner required") — February Pairs, March Pairs, July
  Individual; Thursday (19:00/18:45) — Amandas Nutrimetics Pairs, Marion Sillick
  Pairs, Thu Champ Pairs 5 from 6 (no substitute); Wednesday and Friday have weekday
  rows (13:00/12:45) but no series, so the programme browser still shows them; plus
  Holiday Bridge / No Bridge singles (New Year, Easter Monday, King's Birthday,
  Labour Day, Good Friday). Imported and published via the exact same code paths as
  the `importProgramme` / `publishProgramme` callables
  (`firebase/functions/src/admin/programmeImport.ts` / `programme.ts`).
  - Note: the booklet's Milton Pairs would otherwise end on 2027-03-29, the same
    date as the Easter Monday Holiday Bridge single — exactly the kind of clash
    `importProgramme`'s cross-file check catches. The seed (and the
    `shared/templates/series.csv` template) moves that date to 2027-04-05 instead,
    the way the club's own printed booklet does when this happens.

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

Expected output:

```
Seeding demo data into project "demo-obc" (Firestore: ..., Auth: ...)
Seeded 20 members (added 20, updated 0, unchanged 0).
Imported 2027 programme: 5 weekday(s), 12 series, 58 session(s).
Published 2027 programme at <timestamp>.
```

`firebase/functions/package.json` runs the script with `tsx` (`tsx ../seed/seed.ts`) so
it executes the TypeScript source directly under Node 22 ESM, no separate build step.

## Implementation

`firebase/seed/seed.ts`:
- provisions members by calling `provisionMember` directly (imported dynamically,
  after the emulator/project guard has run, since importing it initialises the
  Firebase Admin SDK);
- builds the three programme CSVs in-memory (mirroring
  `shared/templates/weekdays.csv` / `series.csv` / `singles.csv`, extended with the
  Thursday series and the remaining singles) and imports them via
  `runProgrammeImport` — the same core `importProgramme` uses — then publishes via
  `runPublishProgramme` — the same core `publishProgramme` uses. If the import
  reports any row errors the script prints them and exits non-zero rather than
  silently seeding a broken programme.

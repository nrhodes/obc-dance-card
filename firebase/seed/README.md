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
- A **second, published programme keyed to the current NZ year** (plan §21 B3
  "two-year horizon"; skipped if that year is 2027, so the seed still works
  standalone in 2027 itself): one Monday weekday row ("Monday Bridge"), one
  series — **Spring Pairs**, running the *next two* upcoming Mondays — and two
  standalone ("Casual Monday Bridge") singles on the *two most recent past*
  Mondays (all four dates computed from `todayNZ()`/`addDaysNZ`, any that spill
  into an adjacent year dropped). This is what gives plan §21 B3's "hide past
  events by default" and the multi-year merge something real to show against —
  the 2027 programme above is always in the future relative to a real clock.
  The two past Mondays are seeded as standalone singles rather than more
  `Spring Pairs` sessions on purpose: B3's own hiding rule keeps a series with
  *any* future session fully visible (every date shown, past ones just dimmed),
  so folding all four dates into one series would leave nothing for the "Show
  earlier sessions" toggle to actually hide — see the comment above
  `CASUAL_MONDAY_TITLE` in `seed.ts`. `Spring Pairs` is also deliberately a
  different name from every 2027 Monday series (not "Marion Taylor Pairs" etc.)
  so the two years' cards never carry the same visible text on the Monday tab,
  which would break `programme.spec.ts` / `a11y.spec.ts`'s Playwright
  selectors; the `seriesId` collision the plan calls out
  (`${weekday}-${slug(name)}` can collide across years) is instead exercised by
  a unit test — see `web/src/lib/programmeView.test.ts`'s "cross-year seriesId
  collision" suite.

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
Imported <currentYear> programme: 1 weekday(s), 1 series, 4 session(s) (past Mondays: ...; future Mondays: ...).
Published <currentYear> programme at <timestamp>.
```

(In a real 2027 run, the second programme step is skipped instead — see above.)

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

# CSV import formats

Templates: [`shared/templates/`](../shared/templates/). Row types:
[`shared/src/csv.ts`](../shared/src/csv.ts). All imports are admin-only callables,
run against a **draft** programme; the admin reviews the report, then publishes.

General rules:

- Parsed with `papaparse` (`header: true, skipEmptyLines: true`). Files over
  1 MB or 2 000 rows are rejected outright; an unknown or missing header is
  rejected with a clear message before any row is processed.
- The header row must match the documented column names exactly (order does not
  matter).
- Every value is trimmed and capped at 500 characters per cell. Booleans accept
  `true/false/yes/no/y/n/1/0` (case-insensitive); blank counts as `false`.
- Dates are `YYYY-MM-DD`. Date lists are separated by `;` (or `,`), and are
  de-duplicated and sorted on import.
- A bad row is reported with its 1-based row number and skipped; the rest still
  import. `dryRun: true` validates every row and reports without writing
  anything; a real run validates everything first, then writes in batches of
  ≤ 400 inside one logical import, and records the report to `imports/{id}`.
- `importProgramme` on an already-published year requires `replace: true`, and
  refuses if removing a session would orphan any non-cancelled entry.

## `members.csv`

| Column | Notes |
|---|---|
| `firstName` | required |
| `lastName` | required |
| `email` | required, unique; lower-cased on import; becomes the login identity |
| `phone` | optional |
| `grade` | `Open` / `Intermediate` / `Junior` / `Unknown`; unrecognised → `Unknown` |

Upsert is keyed on `email`. A member present in the DB but **absent** from a later
import is set `active: false` (never deleted). Report: added / updated /
deactivated / unchanged / errors.

## `weekdays.csv`

| Column | Notes |
|---|---|
| `weekday` | `monday`…`friday` |
| `label` | e.g. `Monday Afternoon` |
| `startTime` | `HH:MM` 24h |
| `seatedBy` | `HH:MM` 24h |
| `stewardEmail` | must resolve to an active member, or blank |
| `notes` | e.g. `No partner required` |

## `series.csv` — one row per series

| Column | Notes |
|---|---|
| `weekday` | `monday`…`friday` |
| `name` | series name as printed |
| `scoring` | `Scr` or `Hcp` |
| `format` | `Pairs`, `Teams`, or `Individual` |
| `bestOfN` / `bestOfM` | integers, or blank (e.g. `5` and `6` for "5 from 6") |
| `allowSubstitute` | boolean; `no` for championship series marked "no substitute" |
| `eligibilityNote` | free text, displayed only |
| `note` | free text, displayed only |
| `dates` | `;`-separated `YYYY-MM-DD` list; one session generated per date |
| `teamMin` | optional integer; ignored unless `format` is `Teams`. Default `4` |
| `teamMax` | optional integer; ignored unless `format` is `Teams`. Default `6` |

## `singles.csv` — Holiday Bridge / No Bridge one-offs

| Column | Notes |
|---|---|
| `date` | `YYYY-MM-DD` |
| `weekday` | `monday`…`friday` |
| `kind` | `holidayBridge` or `noBridge` |
| `title` | e.g. `Labour Day - Holiday Bridge` |
| `partnerRequired` | boolean; ignored for `noBridge` |

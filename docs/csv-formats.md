# CSV import formats

Templates: [`shared/templates/`](../shared/templates/). Row types:
[`shared/src/csv.ts`](../shared/src/csv.ts). All imports are admin-only callables,
run against a **draft** programme; the admin reviews the report, then publishes.

General rules:

- The header row must match the documented column names exactly (order does not
  matter).
- Every value is trimmed. Booleans accept `true/false/yes/no/y/n/1/0`
  (case-insensitive); blank counts as `false`.
- Dates are `YYYY-MM-DD`. Date lists are separated by `;` (or `,`), and are
  de-duplicated and sorted on import.
- A bad row is reported with its 1-based row number and skipped; the rest still
  import. `dryRun: true` validates and reports without writing.

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

## `singles.csv` — Holiday Bridge / No Bridge one-offs

| Column | Notes |
|---|---|
| `date` | `YYYY-MM-DD` |
| `weekday` | `monday`…`friday` |
| `kind` | `holidayBridge` or `noBridge` |
| `title` | e.g. `Labour Day - Holiday Bridge` |
| `partnerRequired` | boolean; ignored for `noBridge` |

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
  import (this applies to `importMembers`, which imports row-by-row).
  `dryRun: true` validates every row and reports without writing anything; a
  real run validates everything first, then writes in batches of ≤ 400 inside
  one logical import, and records the report to `imports/{id}`.
- `importProgramme` is **all-or-nothing across all three files**, unlike
  `importMembers`: `weekdays.csv` + `series.csv` + `singles.csv` are validated
  together as one unit (every row of every file, plus the cross-file checks
  below), and if *any* row anywhere has an error, nothing is written — the
  report still shows the row errors and the counts that *would* have been
  written, so the admin can fix the file and re-run. `dryRun: true` runs
  exactly the same validation (including the "already published" and
  "would orphan an entry" checks below) and never writes, whether or not
  there are errors.

### `importProgramme` cross-file checks

- Every `weekday` referenced by a `series.csv` or `singles.csv` row must have
  a corresponding `weekdays.csv` row — otherwise that row is an error.
- **Weekday/date consistency**: for every date generated (each date in a
  series row's `dates` list, and each `singles.csv` row's `date`), the actual
  day of the week the date falls on (via `weekdayOfNZ`, plan §6) must equal
  the row's `weekday` column. A mismatch is a row error naming both the date
  and the weekday it actually falls on — this is deliberately strict because a
  transcription slip here (the printed date not matching the printed weekday)
  is the single most common booklet-transcription mistake.
- No two sessions — whether generated from `series.csv` or from
  `singles.csv` — may land on the same (`date`, `weekday`); a collision is a
  row error against every session that shares the pair.
- `stewardEmail` (in `weekdays.csv`), when non-blank, must resolve to an
  *active* member; otherwise the row is an error.

### Deterministic ids (plan §5.4)

- `weekday` doc id: the `Weekday` value itself (`monday`, …).
- `seriesId`: `${weekday}-${slug(name)}`, where `slug` lower-cases the name,
  replaces runs of non-alphanumeric characters with a single `-`, and trims
  leading/trailing `-`. If two series on the same weekday slugify to the same
  base, the second, third, … (in file order) gets `-2`, `-3`, … appended.
- `sessionId`: `${seriesId}-${date}` for a series-generated session,
  `${year}-${date}-${weekday}` for a `singles.csv` row.
- Re-running the import over the same input always produces the same ids, so
  a re-import (draft, or `replace: true` over a published year) cleanly
  replaces the prior set of `weekdays`/`series`/`sessions` docs rather than
  accumulating duplicates.

### `replace` semantics

- If `programmes/{year}` does not exist yet, or exists with `status: 'draft'`,
  the import proceeds without needing `replace: true` — it (re-)writes the
  whole `weekdays`/`series`/`sessions` set for that year and leaves the
  programme in `draft`.
- If `programmes/{year}` is already `published`, the import is refused
  (`failed-precondition`) unless `replace: true` is passed.
- With `replace: true` over a published year: the import computes which
  existing session ids would disappear under the new content. If any of them
  has a non-cancelled `entries` doc, the whole import is refused
  (`failed-precondition`, listing up to 10 affected dates) and **nothing is
  written** — cancel those entries first, or don't drop those sessions.
  Otherwise it deletes every existing `weekdays`/`series`/`sessions` doc for
  the year and writes the new set, **keeping** `status: 'published'`
  (publishing is a separate step — replacing a programme's content never
  un-publishes it) and updating `importedAt`.

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

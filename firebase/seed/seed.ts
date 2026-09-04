#!/usr/bin/env -S node
/**
 * Emulator-only seed script (plan §16 Phase 1 + 2, §19). Loads a
 * representative member roster into the running emulator via the exact same
 * provisioning code path as `importMembers`
 * (`functions/src/admin/provisionMember.ts`), then imports and publishes a
 * 2027 programme (transcribed from the club's printed booklet) via the exact
 * same code paths as `importProgramme` / `publishProgramme`
 * (`functions/src/admin/programmeImport.ts` / `programme.ts`).
 *
 * Run with `npm run seed -w @obc/functions` (from the repo root) or
 * `npm run seed` from `firebase/functions`. Requires the Firestore + Auth
 * emulators to already be running (`npm run emulators` from the repo root)
 * and refuses to run against anything but a `demo-*` project id.
 */

// A static import, not a dynamic one like the Admin-SDK-touching modules
// below: `seedGuard.ts` has zero imports of its own and does no I/O, so
// importing it here does not risk initialising anything before the guard has
// had a chance to run (and it's what `seedGuard.test.ts` exercises directly).
import { checkEmulatorSafe } from '../functions/src/lib/seedGuard.js';
// Pure date helpers only (no Admin SDK, no I/O) — safe to import statically
// alongside `seedGuard.ts` above, ahead of the guard running.
import { addDaysNZ, todayNZ, weekdayOfNZ } from '@obc/shared';

function assertEmulatorSafe(): string {
  try {
    return checkEmulatorSafe(process.env, process.argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

interface SeedMemberSpec {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  grade: 'Open' | 'Intermediate' | 'Junior' | 'Unknown';
  role?: 'admin';
}

const FIRST_NAMES = [
  'Jane', 'John', 'Mary', 'Alex', 'Peter', 'Susan', 'David', 'Linda', 'Robert', 'Karen',
  'Michael', 'Barbara', 'William', 'Patricia', 'Richard', 'Nancy', 'Thomas', 'Betty',
  'Charles', 'Margaret',
];
const LAST_NAMES = [
  'Doe', 'Smith', 'Brown', 'Taylor', 'Wilson', 'Clark', 'Hall', 'Young', 'King', 'Wright',
  'Green', 'Baker', 'Adams', 'Nelson', 'Carter', 'Mitchell', 'Roberts', 'Turner', 'Phillips',
  'Campbell',
];
const GRADES: SeedMemberSpec['grade'][] = ['Open', 'Intermediate', 'Junior', 'Unknown'];

/**
 * App-Store-review cohort partition (plan §8.1, decided 2026-09-05): the seed
 * additionally provisions this many `cohort: 'review'` members, through the
 * exact same `provisionReviewMembers` path `provision-review-cohort.ts`'s CLI
 * uses, with a fixed, known, emulator-only password — so both rules tests and
 * `web/e2e/review-cohort.spec.ts` can sign in as a reviewer without any
 * secret beyond what's in this repo. Never used against a real project (this
 * file is `checkEmulatorSafe`-gated, see `main()` below).
 */
export const SEED_REVIEW_COUNT = 2;
export const SEED_REVIEW_DOMAIN = 'reviewer.example.test';
export const SEED_REVIEW_PASSWORD = 'ci-dev-reviewer-pw-1';

function buildSeedMembers(): SeedMemberSpec[] {
  const members: SeedMemberSpec[] = [];
  for (let i = 0; i < FIRST_NAMES.length; i++) {
    const firstName = FIRST_NAMES[i]!;
    const lastName = LAST_NAMES[i]!;
    members.push({
      firstName,
      lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.org`,
      phone: `021 555 ${String(100 + i).padStart(4, '0')}`,
      grade: GRADES[i % GRADES.length]!,
    });
  }
  // Make the first member an admin, distinct from the rest.
  members[0] = {
    firstName: 'Admin',
    lastName: 'User',
    email: 'admin@example.org',
    phone: '021 555 0000',
    grade: 'Open',
    role: 'admin',
  };
  return members;
}

/* -------------------------------------------------------------------------- */
/* 2027 programme (transcribed from the printed booklet)                    */
/* -------------------------------------------------------------------------- */

const PROGRAMME_YEAR = 2027;

/** Quotes a CSV field only when it needs it (contains a comma, quote, or newline). */
function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
function csvRow(fields: string[]): string {
  return fields.map(csvField).join(',');
}

function weekdaysCsv(): string {
  const rows = [
    ['weekday', 'label', 'startTime', 'seatedBy', 'stewardEmail', 'notes'],
    ['monday', 'Monday Afternoon', '13:00', '12:45', 'admin@example.org', ''],
    ['tuesday', 'Tuesday (Juniors) Evening', '19:00', '18:45', '', 'No partner required'],
    ['wednesday', 'Wednesday Afternoon', '13:00', '12:45', '', ''],
    ['thursday', 'Thursday Evening', '19:00', '18:45', '', ''],
    ['friday', 'Friday Afternoon', '13:00', '12:45', '', ''],
  ];
  return rows.map(csvRow).join('\n');
}

function seriesCsv(): string {
  const rows = [
    ['weekday', 'name', 'scoring', 'format', 'bestOfN', 'bestOfM', 'allowSubstitute', 'eligibilityNote', 'note', 'dates', 'teamMin', 'teamMax'],
    // Monday
    ['monday', 'Marion Taylor Pairs', 'Scr', 'Pairs', '', '', 'yes', '', '', '2027-01-11;2027-01-18;2027-01-25;2027-02-01', '', ''],
    ['monday', 'Campbell Cave Pairs', 'Scr', 'Pairs', '', '', 'yes', '', '', '2027-02-08;2027-02-15;2027-02-22;2027-03-01', '', ''],
    ['monday', 'Milton Pairs', 'Hcp', 'Pairs', '', '', 'yes', '', '', '2027-03-08;2027-03-15;2027-03-22;2027-04-05', '', ''],
    [
      'monday',
      'Martin Gillam Memorial Mon Champ Pairs',
      'Scr',
      'Pairs',
      '5',
      '6',
      'no',
      '',
      'no substitute',
      '2027-04-12;2027-04-19;2027-04-26;2027-05-03;2027-05-10;2027-05-17',
      '',
      '',
    ],
    [
      'monday',
      'Summerset Mon Individual',
      'Scr',
      'Individual',
      '4',
      '5',
      'yes',
      '',
      '',
      '2027-08-16;2027-08-23;2027-08-30;2027-09-06;2027-09-13',
      '',
      '',
    ],
    [
      'monday',
      'Campbell Cave Teams',
      'Scr',
      'Teams',
      '',
      '',
      'yes',
      'Max 1 open player, min 1 junior player',
      '',
      '2027-09-20;2027-09-27;2027-10-04',
      '4',
      '6',
    ],
    // Tuesday (juniors)
    ['tuesday', 'February Pairs', 'Scr', 'Pairs', '', '', 'yes', '', '', '2027-02-02;2027-02-09;2027-02-16;2027-02-23', '', ''],
    ['tuesday', 'March Pairs', 'Scr', 'Pairs', '', '', 'yes', '', '', '2027-03-02;2027-03-09;2027-03-16;2027-03-23;2027-03-30', '', ''],
    ['tuesday', 'July Individual', 'Scr', 'Individual', '', '', 'yes', '', '', '2027-07-06;2027-07-13;2027-07-20;2027-07-27', '', ''],
    // Thursday
    ['thursday', "Amandas Nutrimetics Pairs", 'Hcp', 'Pairs', '', '', 'yes', '', '', '2027-01-14;2027-01-21;2027-01-28;2027-02-04', '', ''],
    ['thursday', 'Marion Sillick Pairs', 'Scr', 'Pairs', '', '', 'yes', '', '', '2027-02-11;2027-02-18;2027-02-25;2027-03-04', '', ''],
    [
      'thursday',
      'Thu Champ Pairs 5 from 6',
      'Scr',
      'Pairs',
      '5',
      '6',
      'no',
      '',
      'no substitute',
      '2027-03-11;2027-03-18;2027-03-25;2027-04-01;2027-04-08;2027-04-15',
      '',
      '',
    ],
  ];
  return rows.map(csvRow).join('\n');
}

function singlesCsv(): string {
  const rows = [
    ['date', 'weekday', 'kind', 'title', 'partnerRequired'],
    ['2027-01-04', 'monday', 'holidayBridge', 'Holiday Bridge', 'yes'],
    // Easter Monday collides with Milton Pairs' original 4th date (plan
    // note in the Phase 2a task): Milton Pairs was moved to end on 04-05
    // instead of 03-29 so both can exist without a same-day conflict.
    ['2027-03-29', 'monday', 'holidayBridge', 'Easter Monday - Holiday Bridge', 'yes'],
    ['2027-06-07', 'monday', 'holidayBridge', "King's Birthday - Holiday Bridge", 'yes'],
    ['2027-10-25', 'monday', 'holidayBridge', 'Labour Day - Holiday Bridge', 'yes'],
    ['2027-04-02', 'friday', 'noBridge', 'Good Friday - No Bridge', 'no'],
  ];
  return rows.map(csvRow).join('\n');
}

/* -------------------------------------------------------------------------- */
/* Second, current-dated programme (plan §21 B3: "two-year horizon")         */
/*                                                                            */
/* The 2027 programme above is fixed/transcribed and always in the future    */
/* relative to a real clock, which is exactly what most specs want (a stable */
/* programme that never goes stale) — but it can never exercise "hide past   */
/* events by default", since every one of its sessions is always upcoming.   */
/* This second programme is keyed to *today's* NZ year and includes two      */
/* already-past sessions and two upcoming ones, so B3's past-hiding default  */
/* and the two-year merge both have something real to show against.         */
/* -------------------------------------------------------------------------- */

/** True when `date` (`YYYY-MM-DD`) falls on a Monday (NZ) — `weekdayOfNZ` throws for Sat/Sun. */
function isMondayNZ(date: string): boolean {
  try {
    return weekdayOfNZ(date) === 'monday';
  } catch {
    return false;
  }
}

/**
 * `count` Mondays starting from `addDaysNZ(from, direction)` and walking in
 * `direction` (+1 forward, -1 backward) one calendar day at a time. Nearest
 * first — e.g. `direction: -1` returns `[mostRecentMonday, theOneBeforeThat]`.
 */
function walkMondays(from: string, direction: 1 | -1, count: number): string[] {
  const found: string[] = [];
  let date = from;
  // A week has 7 days; bound the walk generously (any `count` here is small).
  for (let i = 0; i < count * 7 + 7 && found.length < count; i++) {
    date = addDaysNZ(date, direction);
    if (isMondayNZ(date)) found.push(date);
  }
  return found;
}

/**
 * Distinct from every 2027 Monday series name on purpose (plan §21 B3 seed
 * note): the natural way to exercise the seriesId collision the plan calls
 * out (`${weekday}-${slug(name)}` can collide across years) would be to
 * reuse a 2027 Monday series name here too — but `programme.spec.ts` and
 * `a11y.spec.ts` already assert on the *text* "Marion Taylor Pairs" being
 * visible/unique on the Monday tab, and reusing that name would make both
 * years' cards carry the same heading text, breaking those (Playwright
 * strict-mode) selectors. The plan explicitly allows this fallback: keep
 * seed names distinct and cover the collision with a unit test instead —
 * see `web/src/lib/programmeView.test.ts`'s "cross-year seriesId collision"
 * suite, which exercises the exact same `${weekday}-${slug(name)}` shape
 * colliding (`monday-pairs`, deliberately shared between two fake years).
 */
const SPRING_PAIRS_NAME = 'Spring Pairs';

/**
 * The two most recent past Mondays are seeded as standalone singles, not as
 * more `Spring Pairs` sessions, even though the plan's B3 seed sketch reads
 * as "4 sessions, one series" (`seriesId`-shaped ids for all four). Reason:
 * per B3's own past-hiding rule, a series with *any* future session is
 * "partially past" and stays fully visible — every date shown, past ones
 * merely dimmed (`session-past`) — never hidden by the toggle. If all four
 * dates belonged to one series, there would be nothing on the Monday tab
 * that the "Show earlier sessions" toggle actually hides, and the e2e
 * coverage B3 asks for (a past session hidden by default, shown after the
 * toggle) would have nothing real to assert against. Splitting the two past
 * Mondays out as standalone sessions — which the fully-past-standalone rule
 * *does* hide by default — keeps the seed exercising the feature it exists
 * to demonstrate, while `Spring Pairs` (the two future Mondays) exercises
 * the two-year merge and cross-year navigation instead.
 */
const CASUAL_MONDAY_TITLE = 'Casual Monday Bridge';

function currentYearWeekdaysCsv(): string {
  const rows = [
    ['weekday', 'label', 'startTime', 'seatedBy', 'stewardEmail', 'notes'],
    ['monday', 'Monday Bridge', '13:00', '12:45', 'admin@example.org', ''],
  ];
  return rows.map(csvRow).join('\n');
}

/**
 * `Spring Pairs`, running on the upcoming Monday dates only (see the note
 * above `CASUAL_MONDAY_TITLE`). Omits the series row entirely if
 * `futureDates` is empty (year-boundary edge) rather than import a series
 * with zero dates.
 */
function currentYearSeriesCsv(futureDates: string[]): string {
  const rows = [['weekday', 'name', 'scoring', 'format', 'bestOfN', 'bestOfM', 'allowSubstitute', 'eligibilityNote', 'note', 'dates', 'teamMin', 'teamMax']];
  if (futureDates.length > 0) {
    rows.push(['monday', SPRING_PAIRS_NAME, 'Scr', 'Pairs', '', '', 'yes', '', '', futureDates.join(';'), '', '']);
  }
  return rows.map(csvRow).join('\n');
}

/** One standalone (non-series) single per past Monday date — see the note above `CASUAL_MONDAY_TITLE`. */
function currentYearSinglesCsv(pastDates: string[]): string {
  const rows = [
    ['date', 'weekday', 'kind', 'title', 'partnerRequired'],
    ...pastDates.map((date) => [date, 'monday', 'holidayBridge', CASUAL_MONDAY_TITLE, 'yes']),
  ];
  return rows.map(csvRow).join('\n');
}

async function main(): Promise<void> {
  const projectId = assertEmulatorSafe();
  // Set before any dynamic import below runs `initializeApp()` inside
  // `functions/src/lib/admin.ts` — the Admin SDK's default app needs a
  // project id from the environment when there's no service account.
  process.env.GCLOUD_PROJECT = projectId;

  // Dynamic imports: must happen *after* the guard above and the env var is
  // set, since importing these modules eagerly initialises the Admin SDK.
  const { provisionMember } = await import('../functions/src/admin/provisionMember.js');
  const { BatchWriter } = await import('../functions/src/lib/batchWriter.js');
  const { runProgrammeImport } = await import('../functions/src/admin/programmeImport.js');
  const { runPublishProgramme } = await import('../functions/src/admin/programme.js');
  const { provisionReviewMembers } = await import('../scripts/provision-review-cohort.js');
  const { db, auth } = await import('../functions/src/lib/admin.js');

  console.log(`Seeding demo data into project "${projectId}" (Firestore: ${process.env.FIRESTORE_EMULATOR_HOST}, Auth: ${process.env.FIREBASE_AUTH_EMULATOR_HOST})`);

  const writer = new BatchWriter();
  const members = buildSeedMembers();
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let adminUid: string | null = null;

  for (const spec of members) {
    const result = await provisionMember(
      {
        firstName: spec.firstName,
        lastName: spec.lastName,
        emailLower: spec.email.toLowerCase(),
        phone: spec.phone,
        grade: spec.grade,
        role: spec.role,
      },
      { dryRun: false, writer },
    );
    if (result.outcome === 'added') added++;
    else if (result.outcome === 'updated') updated++;
    else unchanged++;
    if (spec.role === 'admin') adminUid = result.memberId;
  }

  await writer.flush();

  console.log(`Seeded ${members.length} members (added ${added}, updated ${updated}, unchanged ${unchanged}).`);

  // ---- App-Store-review cohort partition (plan §8.1, decided 2026-09-05) ----
  const reviewMembers = await provisionReviewMembers(db, auth, SEED_REVIEW_DOMAIN, SEED_REVIEW_PASSWORD, SEED_REVIEW_COUNT);
  console.log(
    `Seeded ${reviewMembers.length} review-cohort member(s): ${reviewMembers.map((m) => m.email).join(', ')} (password: ${SEED_REVIEW_PASSWORD}).`,
  );

  if (!adminUid) {
    throw new Error('Seed admin member was not provisioned; cannot import the programme without an admin actor.');
  }

  const importReport = await runProgrammeImport(
    {
      year: PROGRAMME_YEAR,
      weekdaysCsv: weekdaysCsv(),
      seriesCsv: seriesCsv(),
      singlesCsv: singlesCsv(),
    },
    adminUid,
  );

  if (importReport.errors.length > 0) {
    console.error(`Programme import for ${PROGRAMME_YEAR} failed with ${importReport.errors.length} error(s):`);
    for (const e of importReport.errors) console.error(`  [${e.file} row ${e.row}] ${e.message}`);
    process.exit(1);
  }
  for (const w of importReport.warnings) console.warn(`  warning: ${w}`);
  console.log(
    `Imported ${PROGRAMME_YEAR} programme: ${importReport.weekdays} weekday(s), ${importReport.series} series, ${importReport.sessions} session(s).`,
  );

  const publishResult = await runPublishProgramme({ year: PROGRAMME_YEAR }, adminUid);
  console.log(`Published ${PROGRAMME_YEAR} programme at ${publishResult.publishedAt}.`);

  // ---- second, current-dated programme (plan §21 B3 "two-year horizon") ----
  const currentYear = Number(todayNZ().slice(0, 4));
  if (currentYear === PROGRAMME_YEAR) {
    console.log(
      `Current NZ year is ${currentYear}, same as the seeded ${PROGRAMME_YEAR} programme — skipping the second, current-dated programme.`,
    );
    return;
  }

  const today = todayNZ();
  // Nearest-first from `walkMondays`; sort ascending for readability in CSVs/logs.
  const pastMondays = walkMondays(today, -1, 2)
    .filter((d) => d.startsWith(`${currentYear}-`)) // drop any that spilled into an adjacent year (year-boundary edge)
    .sort();
  const futureMondays = walkMondays(today, 1, 2)
    .filter((d) => d.startsWith(`${currentYear}-`))
    .sort();

  if (pastMondays.length === 0 && futureMondays.length === 0) {
    console.warn(`No Monday session dates for ${currentYear} landed inside the year (year-boundary edge) — skipping the second programme.`);
    return;
  }

  const currentYearImportReport = await runProgrammeImport(
    {
      year: currentYear,
      weekdaysCsv: currentYearWeekdaysCsv(),
      seriesCsv: currentYearSeriesCsv(futureMondays),
      singlesCsv: currentYearSinglesCsv(pastMondays),
    },
    adminUid,
  );

  if (currentYearImportReport.errors.length > 0) {
    console.error(`Programme import for ${currentYear} failed with ${currentYearImportReport.errors.length} error(s):`);
    for (const e of currentYearImportReport.errors) console.error(`  [${e.file} row ${e.row}] ${e.message}`);
    process.exit(1);
  }
  for (const w of currentYearImportReport.warnings) console.warn(`  warning: ${w}`);
  console.log(
    `Imported ${currentYear} programme: ${currentYearImportReport.weekdays} weekday(s), ${currentYearImportReport.series} series, ${currentYearImportReport.sessions} session(s) (past Mondays: ${pastMondays.join(', ') || 'none'}; future Mondays: ${futureMondays.join(', ') || 'none'}).`,
  );

  const currentYearPublishResult = await runPublishProgramme({ year: currentYear }, adminUid);
  console.log(`Published ${currentYear} programme at ${currentYearPublishResult.publishedAt}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

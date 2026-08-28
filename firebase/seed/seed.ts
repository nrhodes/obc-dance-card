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

function getProjectId(): string | undefined {
  const argIdx = process.argv.findIndex((a) => a === '--project');
  if (argIdx >= 0 && process.argv[argIdx + 1]) return process.argv[argIdx + 1];
  return process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? process.env.GCP_PROJECT;
}

function assertEmulatorSafe(): string {
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;

  if (!firestoreHost || !authHost) {
    console.error(
      'Refusing to seed: FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST must both be set.\n' +
        'Start the emulators first (npm run emulators), which sets these for anything run via\n' +
        '`firebase emulators:exec`, or export them yourself if the emulators are already running.',
    );
    process.exit(1);
  }

  const projectId = getProjectId();
  if (!projectId || !projectId.startsWith('demo-')) {
    console.error(
      `Refusing to seed: project id must start with "demo-" (got ${projectId ?? '(none)'}). ` +
        'Pass --project demo-obc or set GCLOUD_PROJECT.',
    );
    process.exit(1);
  }

  return projectId;
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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env -S node
/**
 * Emulator-only seed script (plan §16 Phase 1, §19). Loads a representative
 * member roster into the running emulator via the exact same provisioning
 * code path as `importMembers` (`functions/src/admin/provisionMember.ts`).
 *
 * Programme seeding (weekdays/series/sessions/pairings/invites) is Phase 2 —
 * TODO once `importProgramme` exists.
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

  console.log(`Seeding demo data into project "${projectId}" (Firestore: ${process.env.FIRESTORE_EMULATOR_HOST}, Auth: ${process.env.FIREBASE_AUTH_EMULATOR_HOST})`);

  const writer = new BatchWriter();
  const members = buildSeedMembers();
  let added = 0;
  let updated = 0;
  let unchanged = 0;

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
  }

  await writer.flush();

  console.log(`Seeded ${members.length} members (added ${added}, updated ${updated}, unchanged ${unchanged}).`);
  console.log('TODO(Phase 2): seed the 2027 programme (weekdays/series/sessions) once importProgramme exists.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env -S node
/**
 * Creates (or tops up) a TEST club in a real project: the club record, a copy
 * of another club's programme for one year, one existing person as its
 * admin, and some clearly-fake members who sign in with a shared password.
 * The logic is `firebase/functions/src/clubs/testClub.ts`; this file is only
 * the command line. See plan §21 B14 and docs/ops-runbook.md "Test club".
 *
 * Reads only, and prints what it would do, unless `--execute` is given.
 * Safe to re-run: nothing is duplicated, an existing programme is never
 * overwritten, and the fake members' password is reset to the one given.
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=./key.json   # Cloud Datastore User + Firebase Authentication Admin
 *   export TEST_CLUB_PASSWORD='…'                      # at least 8 characters; never commit it
 *   npx tsx firebase/scripts/provision-test-club.ts --project obc-dance-card --admin-email you@example.org
 *   npx tsx firebase/scripts/provision-test-club.ts --project obc-dance-card --admin-email you@example.org --execute
 *
 * Options: `--club-id testclub` `--name TestClub` `--short-name Test`
 * `--source-club orewa` `--year 2027` `--count 8`
 * `--domain testclub.example.test`.
 *
 * THE PASSWORD IS SHARED AND THE REPOSITORY IS PUBLIC. It is taken from the
 * environment so it never lands in shell history or in a file here. Anyone
 * who learns it can sign in as a fake member and read the test club —
 * including its directory, which lists the admin's name and email. Nothing
 * outside the test club is readable that way (rules, plan §21 B14.4).
 */
import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { DEFAULT_CLUB_ID } from '@obc/shared';
import { checkRealProject } from '../functions/src/lib/scriptGuard.js';
import { provisionTestClub, type TestClubOptions } from '../functions/src/clubs/testClub.js';

interface Args {
  project: string;
  execute: boolean;
  allowDemo: boolean;
  options: Omit<TestClubOptions, 'password'>;
}

const USAGE =
  'Usage: provision-test-club.ts --project <id> --admin-email <address> [--execute] [--club-id testclub] ' +
  '[--name TestClub] [--short-name Test] [--source-club orewa] [--year 2027] [--count 8] ' +
  '[--domain testclub.example.test] [--allow-demo]   (password: TEST_CLUB_PASSWORD)';

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string>();
  let execute = false;
  let allowDemo = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--execute') execute = true;
    else if (arg === '--allow-demo') allowDemo = true;
    else if (arg.startsWith('--') && argv[i + 1] !== undefined) flags.set(arg.slice(2), argv[++i]!);
    else throw new Error(`Unexpected argument "${arg}". ${USAGE}`);
  }
  const known = ['project', 'admin-email', 'club-id', 'name', 'short-name', 'source-club', 'year', 'count', 'domain'];
  for (const key of flags.keys()) if (!known.includes(key)) throw new Error(`Unknown option --${key}. ${USAGE}`);

  const project = flags.get('project');
  const adminEmail = flags.get('admin-email');
  if (!project || !adminEmail) throw new Error(`--project and --admin-email are required. ${USAGE}`);

  const clubId = flags.get('club-id') ?? 'testclub';
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(clubId)) throw new Error('--club-id must be a lower-case slug.');
  const year = Number(flags.get('year') ?? 2027);
  const memberCount = Number(flags.get('count') ?? 8);
  if (!Number.isInteger(year) || !Number.isInteger(memberCount)) throw new Error('--year and --count must be whole numbers.');

  return {
    project,
    execute,
    allowDemo,
    options: {
      clubId,
      name: flags.get('name') ?? 'TestClub',
      shortName: flags.get('short-name') ?? 'Test',
      timezone: 'Pacific/Auckland',
      sourceClubId: flags.get('source-club') ?? DEFAULT_CLUB_ID,
      year,
      adminEmail,
      memberCount,
      emailDomain: flags.get('domain') ?? 'testclub.example.test',
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const projectId = checkRealProject(args.project, { allowDemo: args.allowDemo });
  const password = process.env.TEST_CLUB_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error('Set TEST_CLUB_PASSWORD (at least 8 characters) — the password every fake member signs in with.');
  }

  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialPath) {
    const keyProject = (JSON.parse(readFileSync(credentialPath, 'utf8')) as { project_id?: string }).project_id;
    if (keyProject !== projectId) {
      throw new Error(`--project is "${projectId}" but the service account key is for "${keyProject ?? '(none)'}".`);
    }
  } else if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'Set GOOGLE_APPLICATION_CREDENTIALS to a service account key with "Cloud Datastore User" and ' +
        '"Firebase Authentication Admin" (or the emulator hosts, with --allow-demo).',
    );
  }

  const o = args.options;
  const emails = Array.from({ length: o.memberCount }, (_, i) => `test${String(i + 1).padStart(2, '0')}@${o.emailDomain}`);
  console.log(`Test club "${o.name}" (clubs/${o.clubId}) in project "${projectId}":`);
  console.log(`  programme: copy of ${o.sourceClubId}'s ${o.year}, unless clubs/${o.clubId} already has one`);
  console.log(`  admin:     the existing person with the given --admin-email`);
  console.log(`  members:   ${o.memberCount} fake, ${emails[0] ?? '(none)'} … ${emails[emails.length - 1] ?? ''}`);
  console.log('  password:  from TEST_CLUB_PASSWORD (not shown)');

  if (!args.execute) {
    console.log('Nothing was written. Re-run with --execute to create it.');
    return;
  }

  const app = getApps().length
    ? getApps()[0]!
    : initializeApp(credentialPath ? { credential: cert(credentialPath), projectId } : { projectId });
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });

  const report = await provisionTestClub(db, getAuth(app), { ...o, password });
  console.log(report.clubCreated ? 'Created the club record.' : 'The club record already existed.');
  console.log(
    report.programmeDocsCopied > 0
      ? `Copied ${report.programmeDocsCopied} programme document(s).`
      : 'The programme was already there; left untouched.',
  );
  console.log(`Admin ${report.admin.memberId}: ${report.admin.created ? 'membership created' : 'already a member; ensured admin'}.`);
  const created = report.members.filter((m) => m.created).length;
  console.log(`Fake members: ${created} created, ${report.members.length - created} already existed (password reset on all).`);
  for (const m of report.members) console.log(`  ${m.email}  ${m.firstName} ${m.lastName}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

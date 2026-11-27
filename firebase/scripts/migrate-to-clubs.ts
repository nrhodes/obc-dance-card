#!/usr/bin/env -S node
/**
 * Stage 1b of plan §21 B14.8: copy the pre-club, top-level Firestore data
 * into the per-club layout (`clubs/orewa/…`, `userPrivate`, `users`). The
 * logic and its exact semantics are in
 * `firebase/functions/src/migration/toClubs.ts`; this file is only the
 * command line.
 *
 * **Read docs/ops-runbook.md "Stage 1b cutover" before running this against
 * production.** The order matters: copy, deploy the new build, copy again.
 *
 * It never modifies or deletes the old documents, it is safe to re-run, and
 * it does nothing but read unless `--execute` is given.
 *
 *   # What would be copied (reads only — the default):
 *   GOOGLE_APPLICATION_CREDENTIALS=./key.json \
 *     npx tsx firebase/scripts/migrate-to-clubs.ts --project obc-dance-card
 *
 *   # Copy:
 *   … migrate-to-clubs.ts --project obc-dance-card --execute
 *
 *   # Check the new layout against the old (reads only; exits 1 on any problem):
 *   … migrate-to-clubs.ts --project obc-dance-card --verify
 *
 *   # Declare the migration finished. After this, --execute is refused:
 *   … migrate-to-clubs.ts --project obc-dance-card --close
 *
 * `--project` is required and must match the service account's project, so a
 * key for one project can never be pointed at another by accident. A `demo-*`
 * project (the emulator) is refused unless `--allow-demo` is passed.
 */
import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { DEFAULT_CLUB_ID, type Club } from '@obc/shared';
import { checkRealProject } from '../functions/src/lib/scriptGuard.js';
import {
  closeClubsMigration,
  migrateToClubs,
  verifyClubsMigration,
  type CollectionReport,
} from '../functions/src/migration/toClubs.js';

interface Args {
  project: string;
  execute: boolean;
  verify: boolean;
  close: boolean;
  allowDemo: boolean;
}

const USAGE = 'Usage: migrate-to-clubs.ts --project <id> [--execute | --verify | --close] [--allow-demo]';

function parseArgs(argv: string[]): Args {
  let project: string | undefined;
  let execute = false;
  let verify = false;
  let close = false;
  let allowDemo = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') project = argv[++i];
    else if (argv[i] === '--execute') execute = true;
    else if (argv[i] === '--verify') verify = true;
    else if (argv[i] === '--close') close = true;
    else if (argv[i] === '--allow-demo') allowDemo = true;
    else throw new Error(`Unknown argument "${argv[i]}". ${USAGE}`);
  }
  if (!project) throw new Error(`--project is required. ${USAGE}`);
  if ([execute, verify, close].filter(Boolean).length > 1) {
    throw new Error(`--execute, --verify and --close are separate runs. ${USAGE}`);
  }
  return { project, execute, verify, close, allowDemo };
}

/** The club record written if `clubs/orewa` does not exist yet. Mirrors `defaultClubRecord` (lib/clubs.ts). */
function clubRecord(now: string): Club {
  return {
    id: DEFAULT_CLUB_ID,
    name: 'Orewa Bridge Club',
    shortName: 'Orewa',
    timezone: 'Pacific/Auckland',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

function printCollections(collections: CollectionReport[]): void {
  const rows = collections.map((c) => ({
    from: c.from,
    to: c.to,
    old: c.oldCount,
    created: c.created,
    refreshed: c.refreshed,
    same: c.same,
    keptNewer: c.keptNewer,
    onlyInNew: c.onlyInNew,
  }));
  console.table(rows);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const projectId = checkRealProject(args.project, { allowDemo: args.allowDemo });

  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialPath) {
    const keyProject = (JSON.parse(readFileSync(credentialPath, 'utf8')) as { project_id?: string }).project_id;
    if (keyProject !== projectId) {
      throw new Error(
        `--project is "${projectId}" but the service account key is for "${keyProject ?? '(none)'}". Refusing to run.`,
      );
    }
  } else if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'Set GOOGLE_APPLICATION_CREDENTIALS to a service account key with the "Cloud Datastore User" role ' +
        '(or FIRESTORE_EMULATOR_HOST, with --allow-demo, to rehearse against the emulator).',
    );
  }

  const app = getApps().length
    ? getApps()[0]!
    : initializeApp(credentialPath ? { credential: cert(credentialPath), projectId } : { projectId });
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });

  const where = process.env.FIRESTORE_EMULATOR_HOST
    ? `emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`
    : 'PRODUCTION Firestore';

  if (args.close) {
    const problems = (await verifyClubsMigration(db, DEFAULT_CLUB_ID)).problems;
    if (problems.length > 0) {
      throw new Error(
        `Not closing: --verify reports ${problems.length} problem(s). Run --execute to catch up, --verify, then --close.`,
      );
    }
    const closedAt = await closeClubsMigration(db, DEFAULT_CLUB_ID, new Date().toISOString());
    console.log(`Migration into "${DEFAULT_CLUB_ID}" closed at ${closedAt} (${where}). --execute is now refused.`);
    return;
  }

  if (args.verify) {
    console.log(`Verifying the "${DEFAULT_CLUB_ID}" migration in project "${projectId}" (${where}). Reads only.`);
    const report = await verifyClubsMigration(db, DEFAULT_CLUB_ID);
    console.log(
      `Checked ${report.checked} old document(s). ` +
        `${report.keptNewer} changed by the new build since copying (fine). ` +
        `${report.onlyInNew} exist only in the new layout (fine once the new build is live).`,
    );
    if (report.problems.length === 0) {
      console.log('OK: every old document has an up-to-date copy and the users index agrees.');
      return;
    }
    console.error(`${report.problems.length} PROBLEM(S):`);
    for (const p of report.problems.slice(0, 50)) console.error(`  ${p.problem}: ${p.path}`);
    if (report.problems.length > 50) console.error(`  … and ${report.problems.length - 50} more`);
    console.error('Re-run with --execute to copy what is missing or stale, then --verify again.');
    process.exitCode = 1;
    return;
  }

  console.log(
    `${args.execute ? 'COPYING' : 'Dry run (nothing will be written) for'} the "${DEFAULT_CLUB_ID}" migration ` +
      `in project "${projectId}" (${where}).`,
  );
  const report = await migrateToClubs(db, {
    clubId: DEFAULT_CLUB_ID,
    club: clubRecord(new Date().toISOString()),
    execute: args.execute,
  });
  printCollections(report.collections);
  const verb = args.execute ? 'Wrote' : 'Would write';
  console.log(
    `${verb} ${report.totalWrites} document(s)` +
      `${report.clubDocCreated ? `, including the clubs/${DEFAULT_CLUB_ID} record` : ''}` +
      ` (${report.usersWritten} users/{uid} index doc(s)).`,
  );
  if (!args.execute) console.log('Nothing was written. Re-run with --execute to copy.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

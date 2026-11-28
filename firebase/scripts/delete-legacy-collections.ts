#!/usr/bin/env -S node
/**
 * Stage 1c of plan §21 B14.8: delete the pre-club top-level collections
 * (`members`, `memberPrivate`, `entries`, `invites`, `teams`, `visitors`,
 * `programmes/…`, `auditLog`, `imports`, `integrity`). Nothing has read or
 * written them since the stage-1b cutover; they are a stale second copy of
 * members' personal data. The logic is `deleteLegacyData` in
 * `firebase/functions/src/migration/toClubs.ts`.
 *
 * THIS DELETES DATA AND CANNOT BE UNDONE except from a Firestore backup.
 * It refuses unless the migration has been closed (`migrate-to-clubs.ts
 * --close`), it touches nothing under `clubs/`, `users` or `userPrivate`,
 * and it only counts unless BOTH `--execute` and `--confirm <project id>`
 * are given.
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=./key.json      # Cloud Datastore User
 *   npx tsx firebase/scripts/delete-legacy-collections.ts --project obc-dance-card
 *   npx tsx firebase/scripts/delete-legacy-collections.ts --project obc-dance-card \
 *     --execute --confirm obc-dance-card
 */
import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { DEFAULT_CLUB_ID } from '@obc/shared';
import { checkRealProject } from '../functions/src/lib/scriptGuard.js';
import { deleteLegacyData } from '../functions/src/migration/toClubs.js';

const USAGE =
  'Usage: delete-legacy-collections.ts --project <id> [--execute --confirm <id>] [--allow-demo]';

function parseArgs(argv: string[]): { project: string; execute: boolean; confirm?: string; allowDemo: boolean } {
  let project: string | undefined;
  let confirm: string | undefined;
  let execute = false;
  let allowDemo = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') project = argv[++i];
    else if (argv[i] === '--confirm') confirm = argv[++i];
    else if (argv[i] === '--execute') execute = true;
    else if (argv[i] === '--allow-demo') allowDemo = true;
    else throw new Error(`Unknown argument "${argv[i]}". ${USAGE}`);
  }
  if (!project) throw new Error(`--project is required. ${USAGE}`);
  if (execute && confirm !== project) {
    throw new Error(`To delete, repeat the project id: --execute --confirm ${project}`);
  }
  return { project, execute, confirm, allowDemo };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const projectId = checkRealProject(args.project, { allowDemo: args.allowDemo });

  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialPath) {
    const keyProject = (JSON.parse(readFileSync(credentialPath, 'utf8')) as { project_id?: string }).project_id;
    if (keyProject !== projectId) {
      throw new Error(`--project is "${projectId}" but the service account key is for "${keyProject ?? '(none)'}".`);
    }
  } else if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS (or FIRESTORE_EMULATOR_HOST with --allow-demo).');
  }

  const app = getApps().length
    ? getApps()[0]!
    : initializeApp(credentialPath ? { credential: cert(credentialPath), projectId } : { projectId });
  const db = getFirestore(app);

  const where = process.env.FIRESTORE_EMULATOR_HOST ? 'emulator' : 'PRODUCTION Firestore';
  console.log(
    `${args.execute ? 'DELETING' : 'Counting (nothing will be deleted)'} the pre-club collections ` +
      `in project "${projectId}" (${where}).`,
  );
  const report = await deleteLegacyData(db, DEFAULT_CLUB_ID, { execute: args.execute });
  console.table(report.collections);
  console.log(
    args.execute
      ? `Deleted ${report.totalDocuments} document(s).`
      : `${report.totalDocuments} document(s) would be deleted. Re-run with --execute --confirm ${projectId} to delete.`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

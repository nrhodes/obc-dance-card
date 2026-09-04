#!/usr/bin/env -S node
/**
 * One-off backfill for the App-Store-review cohort partition (plan §8.1,
 * decided 2026-09-05): every `members/{id}`, `entries/{id}` and `teams/{id}`
 * doc written before the `cohort` field existed is missing it. This script
 * stamps `cohort: 'club'` on every one of them — safe by construction: a
 * pre-partition project has no `review` members, so every existing doc is
 * unambiguously `'club'`.
 *
 * MUST run (plus a functions deploy) BEFORE the rules deploy that adds the
 * cohort checks (docs/ops-runbook.md "deployment order") — the new
 * `entries`/`teams` rules require `resource.data.cohort` to exist and match
 * the caller's own; a doc still missing it would compare `undefined ==
 * 'club'` and fail closed for every non-owner read.
 *
 * Modeled on `backfill-member-emails.ts`'s service-account/env conventions:
 * runs against BOTH the emulator (for verification) and a real project, so
 * it does NOT call `checkRealProject`/refuse `demo-*` ids.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./key.json \
 *     npx tsx firebase/scripts/backfill-cohort.ts [--project <id>] [--dry-run]
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-obc \
 *     npx tsx firebase/scripts/backfill-cohort.ts --dry-run
 *
 * Idempotent: a doc that already has `cohort` is left untouched (counted as
 * "skipped"), so re-running is safe.
 */
import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { Entry, Member, Team } from '@obc/shared';

interface Args {
  project?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  let project: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') project = argv[++i];
    else if (argv[i] === '--dry-run') dryRun = true;
  }
  return { project, dryRun };
}

interface ResolvedCredential {
  projectId: string;
  credentialPath?: string;
}

function resolveCredential(argsProject: string | undefined): ResolvedCredential {
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialPath) {
    const json = JSON.parse(readFileSync(credentialPath, 'utf8')) as { project_id?: string };
    const projectId = argsProject ?? json.project_id;
    if (!projectId) {
      throw new Error(`Service account file "${credentialPath}" has no project_id field; pass --project.`);
    }
    return { projectId, credentialPath };
  }
  const projectId = argsProject ?? process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    throw new Error(
      'No credentials or project id resolved. Set GOOGLE_APPLICATION_CREDENTIALS for a real project, ' +
        'or --project / GCLOUD_PROJECT when pointed at the emulator.',
    );
  }
  return { projectId };
}

interface CollectionSummary {
  scanned: number;
  updated: number;
  alreadyHad: number;
}

async function backfillMembers(db: Firestore, dryRun: boolean): Promise<CollectionSummary> {
  const snap = await db.collection('members').get();
  let scanned = 0;
  let updated = 0;
  let alreadyHad = 0;
  for (const doc of snap.docs) {
    scanned++;
    const member = doc.data() as Member;
    if (member.cohort) {
      alreadyHad++;
      continue;
    }
    if (!dryRun) {
      await doc.ref.set({ cohort: 'club', updatedAt: new Date().toISOString() }, { merge: true });
    }
    updated++;
  }
  return { scanned, updated, alreadyHad };
}

async function backfillEntries(db: Firestore, dryRun: boolean): Promise<CollectionSummary> {
  const snap = await db.collection('entries').get();
  let scanned = 0;
  let updated = 0;
  let alreadyHad = 0;
  for (const doc of snap.docs) {
    scanned++;
    const entry = doc.data() as Entry;
    if (entry.cohort) {
      alreadyHad++;
      continue;
    }
    if (!dryRun) {
      await doc.ref.set({ cohort: 'club', updatedAt: new Date().toISOString() }, { merge: true });
    }
    updated++;
  }
  return { scanned, updated, alreadyHad };
}

async function backfillTeams(db: Firestore, dryRun: boolean): Promise<CollectionSummary> {
  const snap = await db.collection('teams').get();
  let scanned = 0;
  let updated = 0;
  let alreadyHad = 0;
  for (const doc of snap.docs) {
    scanned++;
    const team = doc.data() as Team;
    if (team.cohort) {
      alreadyHad++;
      continue;
    }
    if (!dryRun) {
      await doc.ref.set({ cohort: 'club', updatedAt: new Date().toISOString() }, { merge: true });
    }
    updated++;
  }
  return { scanned, updated, alreadyHad };
}

function printSummary(label: string, s: CollectionSummary, dryRun: boolean): void {
  console.log(`\n${label}:`);
  console.log(`  Scanned:      ${s.scanned}`);
  console.log(`  Updated:      ${s.updated}${dryRun ? ' (would update)' : ''}`);
  console.log(`  Already had cohort: ${s.alreadyHad}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { projectId, credentialPath } = resolveCredential(args.project);

  const app = getApps().length
    ? getApps()[0]!
    : initializeApp(credentialPath ? { credential: cert(credentialPath), projectId } : { projectId });
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });

  console.log(
    `Backfilling cohort:'club' onto members/entries/teams in project "${projectId}"${args.dryRun ? ' (dry run — no writes)' : ''}...`,
  );

  const members = await backfillMembers(db, args.dryRun);
  const entries = await backfillEntries(db, args.dryRun);
  const teams = await backfillTeams(db, args.dryRun);

  printSummary('members', members, args.dryRun);
  printSummary('entries', entries, args.dryRun);
  printSummary('teams', teams, args.dryRun);

  if (args.dryRun) {
    console.log('\nDry run only — no writes were made. Re-run without --dry-run to apply.');
  } else {
    console.log(
      '\nDone. Deploy firestore.rules only after this has run against the target project ' +
        '(docs/ops-runbook.md "deployment order").',
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

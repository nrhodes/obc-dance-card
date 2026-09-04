#!/usr/bin/env -S node
/**
 * One-off backfill for the members-directory email amendment
 * (decided 2026-09-05, docs/implementation-plan.md §2/§5.1): existing
 * `members/{id}` docs predate the denormalised `email` field, which
 * `provisionMember` now writes on every create/update. For every member doc
 * missing `email`, this script copies `memberPrivate/{id}.emailLower` onto
 * it.
 *
 * Modeled on `make-admin.ts`'s service-account/env conventions, but — unlike
 * that script — this one is expected to run against BOTH the emulator (for
 * verification, e.g. in this branch's own end-to-end check) and a real
 * project, so it does NOT call `checkRealProject`/refuse `demo-*` ids. It
 * uses whatever Admin SDK credentials it's given:
 *   - `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json` for a real project
 *     (needs "Cloud Datastore User"; no Auth calls are made).
 *   - Or, against a running emulator, just the usual
 *     `FIRESTORE_EMULATOR_HOST` / `GCLOUD_PROJECT` env vars — no service
 *     account required.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./key.json \
 *     npx tsx firebase/scripts/backfill-member-emails.ts [--project <id>] [--dry-run]
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-obc \
 *     npx tsx firebase/scripts/backfill-member-emails.ts --dry-run
 *
 * Idempotent: a member doc that already has `email` is left untouched (and
 * counted as "skipped"), so re-running is safe.
 */
import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { Member, MemberPrivate } from '@obc/shared';

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { projectId, credentialPath } = resolveCredential(args.project);

  const app = getApps().length
    ? getApps()[0]!
    : initializeApp(credentialPath ? { credential: cert(credentialPath), projectId } : { projectId });
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });

  console.log(
    `Backfilling members.email in project "${projectId}"${args.dryRun ? ' (dry run — no writes)' : ''}...`,
  );

  const membersSnap = await db.collection('members').get();

  let scanned = 0;
  let updated = 0;
  let alreadyHadEmail = 0;
  let missingPrivateDoc = 0;

  for (const memberDoc of membersSnap.docs) {
    scanned++;
    const member = memberDoc.data() as Member;
    if (member.email) {
      alreadyHadEmail++;
      continue;
    }

    const privateSnap = await db.doc(`memberPrivate/${memberDoc.id}`).get();
    const emailLower = (privateSnap.data() as MemberPrivate | undefined)?.emailLower;
    if (!emailLower) {
      missingPrivateDoc++;
      console.warn(
        `  SKIP ${memberDoc.id} (${member.firstName} ${member.lastName}): no memberPrivate.emailLower found.`,
      );
      continue;
    }

    if (!args.dryRun) {
      await memberDoc.ref.set({ email: emailLower, updatedAt: new Date().toISOString() }, { merge: true });
    }
    updated++;
  }

  console.log('\nSummary:');
  console.log(`  Scanned:            ${scanned}`);
  console.log(`  Updated:            ${updated}${args.dryRun ? ' (would update)' : ''}`);
  console.log(`  Already had email:  ${alreadyHadEmail}`);
  console.log(`  Skipped (no private/emailLower): ${missingPrivateDoc}`);
  if (args.dryRun) {
    console.log('\nDry run only — no writes were made. Re-run without --dry-run to apply.');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

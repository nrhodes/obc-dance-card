#!/usr/bin/env -S node
/**
 * Grants (or revokes) platform-administrator rights (plan §21 B14.3): writes
 * or deletes `platformAdmins/{uid}`, and records it in `platformAuditLog`.
 *
 * This script is the ONLY way the grant is made. No callable can create a
 * platform admin, so nothing reachable from a browser can promote anyone.
 *
 * A platform admin can create and suspend clubs and appoint their admins
 * (Platform area in the web app). They get no access inside a club beyond
 * their own membership of it. The person must already be able to sign in,
 * i.e. be an active member of some club.
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=./key.json     # Cloud Datastore User
 *   npx tsx firebase/scripts/make-platform-admin.ts --project obc-dance-card --email you@example.org
 *   npx tsx firebase/scripts/make-platform-admin.ts --project obc-dance-card --email you@example.org --revoke
 *
 * Idempotent. `--project` must match the service account key. A `demo-*`
 * project is refused unless `--allow-demo` is given.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { paths, type PlatformAdmin, type PlatformAuditEntry } from '@obc/shared';
import { checkRealProject } from '../functions/src/lib/scriptGuard.js';

const USAGE = 'Usage: make-platform-admin.ts --project <id> --email <address> [--revoke] [--allow-demo]';

function parseArgs(argv: string[]): { project: string; email: string; revoke: boolean; allowDemo: boolean } {
  let project: string | undefined;
  let email: string | undefined;
  let revoke = false;
  let allowDemo = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') project = argv[++i];
    else if (argv[i] === '--email') email = argv[++i];
    else if (argv[i] === '--revoke') revoke = true;
    else if (argv[i] === '--allow-demo') allowDemo = true;
    else throw new Error(`Unknown argument "${argv[i]}". ${USAGE}`);
  }
  if (!project || !email) throw new Error(`--project and --email are required. ${USAGE}`);
  return { project, email: email.trim().toLowerCase(), revoke, allowDemo };
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

  const privateSnap = await db.collection(paths.userPrivates()).where('emailLower', '==', args.email).limit(1).get();
  if (privateSnap.empty) {
    throw new Error('Nobody has that sign-in email. A platform admin must already be a member of some club.');
  }
  const uid = privateSnap.docs[0]!.id;
  const ref = db.doc(paths.platformAdmin(uid));
  const exists = (await ref.get()).exists;
  const now = new Date().toISOString();

  if (args.revoke) {
    if (!exists) {
      console.log(`${uid} is not a platform admin. No change made.`);
      return;
    }
    await ref.delete();
    console.log(`Revoked platform admin from ${uid} in project "${projectId}".`);
    return;
  }

  if (exists) {
    console.log(`${uid} is already a platform admin. No change made.`);
    return;
  }
  const grant: PlatformAdmin = { id: uid, grantedAt: now, grantedBy: 'bootstrap-script' };
  await ref.set(grant);
  const auditId = randomUUID();
  const entry: PlatformAuditEntry = {
    id: auditId,
    at: now,
    actorUid: 'bootstrap-script',
    action: 'platform_admin_granted',
    targetUid: uid,
  };
  await db.doc(paths.platformAuditLogEntry(auditId)).set(entry);
  console.log(
    `${uid} is now a platform admin in project "${projectId}". ` +
      'They will see "Platform" under "More" after refreshing the web app.',
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

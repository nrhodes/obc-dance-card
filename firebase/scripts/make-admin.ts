#!/usr/bin/env -S node
/**
 * One-off first-admin bootstrap script (plan §19 "First admin"). Sets one
 * member's role to `admin` via a service account, writing the same
 * `role_changed` audit-log shape `setMemberRole` would produce — so the very
 * first admin promotion (which, by definition, has no existing admin to call
 * the `setMemberRole` callable with) is still repeatable and auditable
 * instead of a one-off hand edit in the console.
 *
 * Requires a service account: `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`.
 * Refuses to run against a `demo-*` project unless `--allow-demo` is passed
 * (the emulator's seed script already provisions an admin — this script's
 * value is bootstrapping a *real* project, plan §19's `obc-dance-card-dev` /
 * `obc-dance-card`).
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./key.json \
 *     npx tsx firebase/scripts/make-admin.ts --email admin@orewabridgeclub.org.nz
 *
 * Optional: `--project <id>` overrides the project id used for Firestore/Auth
 * calls (defaults to the service account key's own `project_id`).
 *
 * Idempotent: running it again against an existing admin reports "already an
 * admin" and makes no change, rather than erroring.
 *
 * See docs/ops-runbook.md step 6 and docs/security-checklist.md for context.
 */
import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { checkRealProject } from '../functions/src/lib/scriptGuard.js';

interface Args {
  email: string;
  allowDemo: boolean;
  project?: string;
}

function parseArgs(argv: string[]): Args {
  let email: string | undefined;
  let allowDemo = false;
  let project: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--email') email = argv[++i];
    else if (argv[i] === '--allow-demo') allowDemo = true;
    else if (argv[i] === '--project') project = argv[++i];
  }
  if (!email) {
    throw new Error('Usage: make-admin.ts --email <address> [--project <id>] [--allow-demo]');
  }
  return { email, allowDemo, project };
}

interface ServiceAccountInfo {
  projectId: string;
  credentialPath: string;
}

function loadServiceAccount(): ServiceAccountInfo {
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentialPath) {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS must point at a service account JSON file with ' +
        '"Firebase Authentication Admin" and "Cloud Datastore User" roles.',
    );
  }
  const json = JSON.parse(readFileSync(credentialPath, 'utf8')) as { project_id?: string };
  if (!json.project_id) {
    throw new Error(`Service account file "${credentialPath}" has no project_id field.`);
  }
  return { projectId: json.project_id, credentialPath };
}

interface MinimalMember {
  role?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { projectId: credentialProjectId, credentialPath } = loadServiceAccount();
  const resolvedProjectId = checkRealProject(args.project ?? credentialProjectId, { allowDemo: args.allowDemo });

  const app = getApps().length
    ? getApps()[0]!
    : initializeApp({ credential: cert(credentialPath), projectId: resolvedProjectId });
  const auth = getAuth(app);
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });

  const emailLower = args.email.trim().toLowerCase();
  const privateSnap = await db.collection('memberPrivate').where('emailLower', '==', emailLower).limit(1).get();
  if (privateSnap.empty) {
    throw new Error(`No member found with that email. Run importMembers first, then re-run this script.`);
  }
  const uid = privateSnap.docs[0]!.id;

  const memberRef = db.collection('members').doc(uid);
  const memberSnap = await memberRef.get();
  const member = memberSnap.data() as MinimalMember | undefined;
  if (!member) {
    throw new Error(`memberPrivate/${uid} exists but members/${uid} does not — data is inconsistent.`);
  }

  if (member.role === 'admin') {
    console.log(`${uid} is already an admin. No change made.`);
    return;
  }

  const now = new Date().toISOString();
  const previousRole = member.role ?? 'member';
  await memberRef.set({ role: 'admin', updatedAt: now }, { merge: true });

  // Force a fresh sign-in so the new role is visible to `beforeSignIn` and
  // any already-issued ID token (plan §8.2 "Deactivation / role change").
  await auth.revokeRefreshTokens(uid);

  const auditRef = db.collection('auditLog').doc();
  await auditRef.set({
    id: auditRef.id,
    at: now,
    // Distinguishes this from an in-app `setMemberRole` call in the audit
    // trail (plan task brief: "actorMemberId: 'bootstrap-script'").
    actorMemberId: 'bootstrap-script',
    action: 'role_changed',
    targetMemberId: uid,
    entityRef: memberRef.path,
    before: { role: previousRole },
    after: { role: 'admin' },
  });

  console.log(
    `Promoted ${uid} to admin in project "${resolvedProjectId}". Refresh tokens revoked — they must sign in again to see admin access.`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

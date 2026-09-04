#!/usr/bin/env -S node
/**
 * App-Store-review cohort provisioning (plan §8.1, decided 2026-09-05): Apple
 * reviewers need demo logins that can exercise the real programme/schedule
 * without ever seeing (or being seen by) a real member's PII or entries.
 * This creates a small, fixed set of clearly-fake `cohort: 'review'` member
 * accounts — never admins — with a password an Apple reviewer can be handed
 * directly. `cohort` is what `firestore.rules` and every cross-member
 * callable (invites, claims, substitutes, team joins) partition on; this
 * script is the ONLY thing that ever sets it to `'review'` (`importMembers`/
 * `provisionMember`'s CSV path never does — see `provisionMember.ts`'s
 * `MemberRow.cohort` doc comment).
 *
 * Modeled on `make-admin.ts`'s service-account/env/`checkRealProject`
 * conventions, but — like `backfill-member-emails.ts` — also expected to run
 * against the emulator (the seed script calls `provisionReviewMembers`
 * directly, below, rather than shelling out to this CLI) so it does NOT call
 * `checkRealProject`; it uses whatever Admin SDK credentials it's given.
 *
 * Usage (creates/updates N review members, default 4):
 *   GOOGLE_APPLICATION_CREDENTIALS=./key.json \
 *     npx tsx firebase/scripts/provision-review-cohort.ts \
 *       --domain reviewer.orewabridgeclub.org.nz --password <a strong password>
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     GCLOUD_PROJECT=demo-obc npx tsx firebase/scripts/provision-review-cohort.ts \
 *       --domain example.test --password devpassword123 --count 2
 *
 * Deactivate the whole review cohort outside a review window (never deletes —
 * same "keep the row, flip active" convention as `deactivateMember`):
 *   ... npx tsx firebase/scripts/provision-review-cohort.ts --deactivate
 *
 * Idempotent: re-running with the same `--domain` updates the existing
 * review members' password/active state rather than creating duplicates
 * (matched by email, exactly like `provisionMember`). The password is never
 * logged or written anywhere except the Auth user record — only the CLI
 * invocation (the operator's own shell) ever sees it in plaintext.
 */
import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import {
  DEFAULT_NOTIFICATION_PREFS,
  passwordStrengthError,
  type Member,
  type MemberPrivate,
} from '@obc/shared';

/** Clearly-fake names (plan §8.1: "clearly fake names") — never a real member's shape. */
const REVIEW_NAMES: Array<{ firstName: string; lastName: string }> = [
  { firstName: 'Alex', lastName: 'Sharp' },
  { firstName: 'Billie', lastName: 'Trumper' },
  { firstName: 'Casey', lastName: 'Finesse' },
  { firstName: 'Drew', lastName: 'Ruff' },
  { firstName: 'Every', lastName: 'Trick' },
  { firstName: 'Frankie', lastName: 'Slam' },
];
const DEFAULT_COUNT = 4;

interface Args {
  domain?: string;
  password?: string;
  count: number;
  project?: string;
  deactivate: boolean;
}

function parseArgs(argv: string[]): Args {
  let domain: string | undefined;
  let password: string | undefined;
  let count = DEFAULT_COUNT;
  let project: string | undefined;
  let deactivate = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--domain') domain = argv[++i];
    else if (argv[i] === '--password') password = argv[++i];
    else if (argv[i] === '--count') count = Number(argv[++i]);
    else if (argv[i] === '--project') project = argv[++i];
    else if (argv[i] === '--deactivate') deactivate = true;
  }
  if (deactivate) return { domain, password, count, project, deactivate };
  if (!domain) {
    throw new Error('Usage: provision-review-cohort.ts --domain <email domain> --password <password> [--count N] [--project <id>] | --deactivate');
  }
  if (!password) {
    throw new Error('--password is required (one shared password for every review account).');
  }
  const strengthError = passwordStrengthError(password);
  if (strengthError) {
    throw new Error(`--password is too weak: ${strengthError}`);
  }
  if (count < 1 || count > REVIEW_NAMES.length) {
    throw new Error(`--count must be between 1 and ${REVIEW_NAMES.length}.`);
  }
  return { domain, password, count, project, deactivate };
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

export interface ProvisionedReviewMember {
  memberId: string;
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * The reusable core (no CLI parsing, no console output): creates/updates
 * `count` review-cohort members under `domain` with `password`, and returns
 * what was provisioned. Called by this file's `main()` AND directly by the
 * emulator seed script (plan §16 "seed additionally provisions 2 review
 * members"), so the two paths can never drift apart.
 */
export async function provisionReviewMembers(
  db: Firestore,
  auth: Auth,
  domain: string,
  password: string,
  count: number,
): Promise<ProvisionedReviewMember[]> {
  const results: ProvisionedReviewMember[] = [];
  for (let i = 0; i < count; i++) {
    const { firstName, lastName } = REVIEW_NAMES[i]!;
    const emailLower = `reviewer${i + 1}@${domain}`.toLowerCase();

    const existingPrivate = await db.collection('memberPrivate').where('emailLower', '==', emailLower).limit(1).get();
    const now = new Date().toISOString();

    let uid: string;
    if (!existingPrivate.empty) {
      uid = existingPrivate.docs[0]!.id;
      await auth.updateUser(uid, { password, disabled: false });
      await db.doc(`members/${uid}`).set(
        { firstName, lastName, cohort: 'review', role: 'member', active: true, updatedAt: now },
        { merge: true },
      );
      await db.doc(`memberPrivate/${uid}`).set({ hasPassword: true, updatedAt: now }, { merge: true });
    } else {
      let existingAuthUser: string | undefined;
      try {
        existingAuthUser = (await auth.getUserByEmail(emailLower)).uid;
      } catch {
        // not found — created below
      }
      uid = existingAuthUser ?? (await auth.createUser({ email: emailLower, password, emailVerified: true, disabled: false })).uid;
      if (existingAuthUser) await auth.updateUser(uid, { password, disabled: false });

      const member: Member = {
        id: uid,
        firstName,
        lastName,
        phone: '',
        email: emailLower,
        grade: 'Unknown',
        role: 'member',
        cohort: 'review',
        active: true,
        createdAt: now,
        updatedAt: now,
      };
      // Review accounts never want push/email noise (plan §8.1) — they are
      // demo logins, not real members with real notification preferences.
      const memberPrivate: MemberPrivate = {
        id: uid,
        emailLower,
        notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS, push: false, email: false },
        devices: [],
        hasPassword: true,
        createdAt: now,
        updatedAt: now,
      };
      await db.doc(`members/${uid}`).set(member);
      await db.doc(`memberPrivate/${uid}`).set(memberPrivate);
    }

    results.push({ memberId: uid, email: emailLower, firstName, lastName });
  }
  return results;
}

/**
 * Flips every `cohort: 'review'` member to `active: false` (never deletes —
 * plan §8.1 "deactivatable") and disables their Auth user, so the review
 * cohort can be switched off outside a review window without losing the
 * accounts (a re-run without `--deactivate` reactivates and re-provisions
 * them for the next window).
 */
async function deactivateReviewCohort(db: Firestore, auth: Auth): Promise<number> {
  const snap = await db.collection('members').where('cohort', '==', 'review').where('active', '==', true).get();
  const now = new Date().toISOString();
  for (const doc of snap.docs) {
    await doc.ref.set({ active: false, updatedAt: now }, { merge: true });
    await auth.updateUser(doc.id, { disabled: true }).catch(() => undefined);
    await auth.revokeRefreshTokens(doc.id).catch(() => undefined);
  }
  return snap.size;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { projectId, credentialPath } = resolveCredential(args.project);

  const app: App = getApps().length
    ? getApps()[0]!
    : initializeApp(credentialPath ? { credential: cert(credentialPath), projectId } : { projectId });
  const auth = getAuth(app);
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });

  if (args.deactivate) {
    const count = await deactivateReviewCohort(db, auth);
    console.log(`Deactivated ${count} review-cohort member(s) in project "${projectId}".`);
    return;
  }

  console.log(`Provisioning ${args.count} review-cohort member(s) in project "${projectId}" (domain "${args.domain}")...`);
  const results = await provisionReviewMembers(db, auth, args.domain!, args.password!, args.count);

  console.log('\nProvisioned:');
  for (const r of results) {
    console.log(`  ${r.memberId}  ${r.firstName} ${r.lastName}  <${r.email}>`);
  }
  console.log(
    '\nGive the Apple reviewer the email(s) above and the password you passed on the command line — ' +
      'it is not stored anywhere else. Run with --deactivate once the review window is over.',
  );
}

// Only run as a CLI when executed directly — `seed.ts` dynamically imports
// `provisionReviewMembers` from this same module (to reuse this exact
// provisioning path) and must not trigger a second, CLI-arg-parsing `main()`
// as a side effect of that import.
const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href;
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

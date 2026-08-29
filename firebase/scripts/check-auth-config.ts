#!/usr/bin/env -S node
/**
 * Reads a project's Identity Platform / Firebase Auth configuration and
 * reports whether the console-only settings from the security checklist
 * (docs/security-checklist.md, plan §18) are actually turned on:
 *  - email enumeration protection (`emailPrivacyConfig.enableImprovedEmailPrivacy`)
 *  - password policy enforcement (`passwordPolicyConfig.enforcementState`)
 *  - multi-factor auth state (informational only — not required by the plan)
 *  - blocking functions wiring (informational; the real test is the
 *    `beforeUserCreated`/`beforeSignIn` emulator test in
 *    `src/auth/blocking.emu.test.ts` — this just confirms the *deployed*
 *    project has functions attached to both triggers)
 *
 * Requires a service account: `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`
 * with at least the "Firebase Authentication Viewer" role. Refuses to run
 * against a `demo-*` project unless `--allow-demo` is passed (the emulator's
 * Auth REST API doesn't implement `projectConfigManager`, so this is only
 * useful there as a smoke test of the script's own plumbing).
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./key.json \
 *     npx tsx firebase/scripts/check-auth-config.ts --project obc-dance-card
 *
 * Exit code is non-zero if email enumeration protection or the password
 * policy is off, so this can be wired into a pre-pilot checklist gate.
 */
import { readFileSync } from 'node:fs';
import { GoogleAuth } from 'google-auth-library';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { checkRealProject } from '../functions/src/lib/scriptGuard.js';

interface Args {
  allowDemo: boolean;
  project?: string;
}

function parseArgs(argv: string[]): Args {
  let allowDemo = false;
  let project: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--allow-demo') allowDemo = true;
    else if (argv[i] === '--project') project = argv[++i];
  }
  return { allowDemo, project };
}

function loadServiceAccount(): { projectId: string; credentialPath: string } {
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentialPath) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS must point at a service account JSON file.');
  }
  const json = JSON.parse(readFileSync(credentialPath, 'utf8')) as { project_id?: string };
  if (!json.project_id) {
    throw new Error(`Service account file "${credentialPath}" has no project_id field.`);
  }
  return { projectId: json.project_id, credentialPath };
}

/**
 * Fallback for fields the Admin SDK's `ProjectConfig` doesn't expose yet
 * (notably `blockingFunctions`) — the same Identity Toolkit Admin API the SDK
 * itself calls, authenticated with `google-auth-library` (already a
 * transitive dependency of `firebase-admin`, so this adds no new top-level
 * dependency).
 */
async function fetchRawConfig(projectId: string, credentialPath: string): Promise<Record<string, unknown>> {
  const auth = new GoogleAuth({
    keyFile: credentialPath,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) {
    throw new Error('Failed to obtain an access token from the service account.');
  }
  const res = await fetch(`https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`, {
    headers: { Authorization: `Bearer ${token.token}` },
  });
  if (!res.ok) {
    throw new Error(`Identity Toolkit config fetch failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { projectId: credentialProjectId, credentialPath } = loadServiceAccount();
  const resolvedProjectId = checkRealProject(args.project ?? credentialProjectId, { allowDemo: args.allowDemo });

  const app = getApps().length
    ? getApps()[0]!
    : initializeApp({ credential: cert(credentialPath), projectId: resolvedProjectId });
  const auth = getAuth(app);

  const config = await auth.projectConfigManager().getProjectConfig();

  const enumerationProtectionOn = config.emailPrivacyConfig?.enableImprovedEmailPrivacy === true;
  const passwordPolicy = config.passwordPolicyConfig;
  const passwordPolicyEnforced = passwordPolicy?.enforcementState === 'ENFORCE';
  const mfaState = config.multiFactorConfig?.state ?? 'DISABLED';

  console.log(`Auth config for project "${resolvedProjectId}":`);
  console.log(`  Email enumeration protection: ${enumerationProtectionOn ? 'ON' : 'OFF'}`);
  console.log(
    `  Password policy: ${passwordPolicyEnforced ? 'ENFORCED' : (passwordPolicy ? 'CONFIGURED BUT NOT ENFORCED' : 'OFF')}` +
      (passwordPolicy?.constraints
        ? ` (minLength=${passwordPolicy.constraints.minLength ?? '(unset)'}, requireNumeric=${String(
            passwordPolicy.constraints.requireNumeric ?? false,
          )})`
        : ''),
  );
  console.log(`  Multi-factor auth: ${mfaState}`);

  try {
    const raw = await fetchRawConfig(resolvedProjectId, credentialPath);
    const blockingFunctions = raw['blockingFunctions'];
    const hasTriggers =
      blockingFunctions &&
      typeof blockingFunctions === 'object' &&
      Object.keys(blockingFunctions as Record<string, unknown>).length > 0;
    console.log(`  Blocking functions configured: ${hasTriggers ? 'YES' : 'NO'}`);
    if (hasTriggers) {
      console.log(`    ${JSON.stringify(blockingFunctions)}`);
    }
  } catch (err) {
    console.warn(
      `  Blocking functions configured: UNKNOWN (REST fallback failed: ${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }

  if (!enumerationProtectionOn || !passwordPolicyEnforced) {
    console.error('\nFAILED: email enumeration protection and/or the password policy is not fully enabled.');
    console.error('See docs/security-checklist.md for the console click-path to fix this.');
    process.exit(1);
  }

  console.log('\nOK: email enumeration protection and password policy are both enabled.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

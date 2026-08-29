/**
 * Pure "emulator only" guard shared by `firebase/seed/seed.ts` (plan §3 rule
 * 10: "the seed script MUST refuse any project id not starting with
 * `demo-`"). Split out as a dependency-free function so it can be unit
 * tested without pulling in the Admin SDK or touching any environment beyond
 * the plain objects passed in.
 */

export interface EmulatorGuardEnv {
  FIRESTORE_EMULATOR_HOST?: string;
  FIREBASE_AUTH_EMULATOR_HOST?: string;
  GCLOUD_PROJECT?: string;
  FIREBASE_PROJECT?: string;
  GCP_PROJECT?: string;
}

function resolveProjectId(env: EmulatorGuardEnv, argv: readonly string[]): string | undefined {
  const argIdx = argv.findIndex((a) => a === '--project');
  if (argIdx >= 0 && argv[argIdx + 1]) return argv[argIdx + 1];
  return env.GCLOUD_PROJECT ?? env.FIREBASE_PROJECT ?? env.GCP_PROJECT;
}

/**
 * Throws if it is not safe to run an emulator-only script against `env`/
 * `argv`: both emulator host env vars must be set, and the resolved project
 * id must start with `demo-`. Returns the resolved project id otherwise.
 * Pure — no I/O, never calls `process.exit`.
 */
export function checkEmulatorSafe(env: EmulatorGuardEnv, argv: readonly string[]): string {
  if (!env.FIRESTORE_EMULATOR_HOST || !env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error(
      'Refusing to run: FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST must both be set.\n' +
        'Start the emulators first (npm run emulators), which sets these for anything run via\n' +
        '`firebase emulators:exec`, or export them yourself if the emulators are already running.',
    );
  }

  const projectId = resolveProjectId(env, argv);
  if (!projectId || !projectId.startsWith('demo-')) {
    throw new Error(
      `Refusing to run: project id must start with "demo-" (got ${projectId ?? '(none)'}). ` +
        'Pass --project demo-obc or set GCLOUD_PROJECT.',
    );
  }

  return projectId;
}

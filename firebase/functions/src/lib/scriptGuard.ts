/**
 * The mirror image of `seedGuard.ts`: a guard for one-off ops scripts that
 * talk to a *real* Firebase project via a service account
 * (`firebase/scripts/make-admin.ts`, `check-auth-config.ts`, plan §19 "First
 * admin"). Those scripts have no business running against the emulator's
 * `demo-*` placeholder project — refuse unless the caller explicitly opts in
 * with `--allow-demo` (useful only for exercising the script's own plumbing
 * against the emulator's Auth REST API in a manual smoke test).
 */

export interface RealProjectGuardOptions {
  allowDemo?: boolean;
}

/**
 * Throws unless `projectId` is set and (a) does not start with `demo-`, or
 * (b) `options.allowDemo` was passed. Returns `projectId` otherwise. Pure —
 * no I/O, never calls `process.exit`.
 */
export function checkRealProject(projectId: string | undefined, options: RealProjectGuardOptions = {}): string {
  if (!projectId) {
    throw new Error('No project id resolved. Pass --project <id> or set GCLOUD_PROJECT/GOOGLE_CLOUD_PROJECT.');
  }
  if (projectId.startsWith('demo-') && !options.allowDemo) {
    throw new Error(
      `Refusing to run against "${projectId}" — it looks like an emulator-only demo project. ` +
        'Pass --allow-demo if you really mean to run this against the emulator.',
    );
  }
  return projectId;
}

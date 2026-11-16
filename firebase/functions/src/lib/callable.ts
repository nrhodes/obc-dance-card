/**
 * Shared `onCall` options (plan §8.3 callable hardening checklist). Every
 * callable should spread this in, overriding only what genuinely differs
 * (e.g. a longer `timeoutSeconds` for imports).
 *
 * App Check enforcement is a Firebase *param* (`firebase-functions/params`),
 * not a raw `process.env` read — this makes it a first-class deploy-time
 * parameter (surfaced by `firebase deploy`, resolvable per-project via
 * `functions/.env.<projectId>`, plan §19 "Environments") instead of an
 * ad-hoc env var. Enforcement is ON unless the environment says the literal
 * `false`; the committed `.env.demo-obc` says so for the emulator, and
 * nothing else should. See `ENFORCE_APP_CHECK` below.
 */
import type { CallableOptions } from 'firebase-functions/v2/https';
import { defineBoolean } from 'firebase-functions/params';
import { logger } from './logger.js';
import { isDeployed } from './runtime.js';

/**
 * Declared for the CLI's parameter manifest. **Default: enforced.** Only the
 * literal string `false` turns enforcement off, and the committed
 * `.env.demo-obc` is the one place that does so (the emulator cannot mint
 * App Check tokens). Security review 2026-11-16, M3: the previous default of
 * `false` meant a deploy from any checkout lacking a gitignored
 * `.env.<projectId>` silently shipped every callable without App Check — the
 * plan's primary control against cost abuse and automated clients.
 */
export const ENFORCE_APP_CHECK = defineBoolean('ENFORCE_APP_CHECK', { default: true });

/**
 * Resolved from the environment directly rather than `ENFORCE_APP_CHECK
 * .value()`: `CallableOptions.enforceAppCheck` needs a plain boolean at module
 * load, and `.value()` logs a warning during `firebase deploy`'s discovery
 * pass (`FUNCTIONS_CONTROL_API=true`). The CLI has already loaded
 * `.env.<projectId>` into `process.env` by then, so this reads the same
 * value the param would. Fail-closed: anything other than the literal
 * `false` (unset, `true`, a typo) enforces.
 */
const appCheckEnforced = process.env.ENFORCE_APP_CHECK !== 'false';

// Module bodies run exactly once per Cloud Functions instance (cold start),
// so this is naturally a "once per instance" log line — no extra guard needed.
logger.info('app_check_enforced', { enforced: appCheckEnforced });

// A deployed instance must never serve callables without App Check. Throwing
// here fails the container's startup, so a misconfigured `firebase deploy`
// fails its rollout and the previous (enforced) revision keeps serving —
// rather than quietly weakening production. The emulator (`FUNCTIONS_EMULATOR`)
// and the deploy-time discovery pass (not deployed) are unaffected.
if (isDeployed() && !appCheckEnforced) {
  throw new Error(
    'Refusing to start: ENFORCE_APP_CHECK=false on a deployed function. ' +
      'Remove the setting (the default enforces) or set it to true in functions/.env.<projectId>.',
  );
}

export const callableOptions: CallableOptions = {
  region: 'australia-southeast1',
  maxInstances: 5,
  timeoutSeconds: 60,
  memory: '256MiB',
  enforceAppCheck: appCheckEnforced,
  consumeAppCheckToken: false,
};

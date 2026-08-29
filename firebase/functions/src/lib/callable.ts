/**
 * Shared `onCall` options (plan §8.3 callable hardening checklist). Every
 * callable should spread this in, overriding only what genuinely differs
 * (e.g. a longer `timeoutSeconds` for imports).
 *
 * App Check enforcement is a Firebase *param* (`firebase-functions/params`),
 * not a raw `process.env` read — this makes it a first-class deploy-time
 * parameter (surfaced by `firebase deploy`, resolvable per-project via
 * `functions/.env.<projectId>`, plan §19 "Environments") instead of an
 * ad-hoc env var. `BooleanParam.value()` reads `process.env.ENFORCE_APP_CHECK
 * === 'true'` at call time — exactly what the old direct read did — so the
 * emulator (no `.env.<projectId>`, unset ⇒ default `false`) and unit tests
 * (same) keep working unchanged; production sets `ENFORCE_APP_CHECK=true` in
 * `functions/.env.<projectId>`. `onCall` option objects are constructed once
 * at module load (cold start), so `.value()` is read exactly once here rather
 * than per-invocation — fine, since a param's value cannot change without a
 * fresh deploy/cold-start anyway.
 */
import type { CallableOptions } from 'firebase-functions/v2/https';
import { defineBoolean } from 'firebase-functions/params';
import { logger } from './logger.js';

/** Declared for the CLI's parameter manifest; production sets this `true`. */
export const ENFORCE_APP_CHECK = defineBoolean('ENFORCE_APP_CHECK', { default: false });

// `CallableOptions.enforceAppCheck` is a plain boolean (not an Expression), so
// the value must be resolved here. During `firebase deploy`'s discovery pass
// (`FUNCTIONS_CONTROL_API=true`) the SDK logs a warning for any `.value()`
// call; the CLI has already loaded `.env.<projectId>` at that point, so read
// the env directly there and use the param API everywhere else.
const appCheckEnforced =
  process.env.FUNCTIONS_CONTROL_API === 'true'
    ? process.env.ENFORCE_APP_CHECK === 'true'
    : ENFORCE_APP_CHECK.value();

// Module bodies run exactly once per Cloud Functions instance (cold start),
// so this is naturally a "once per instance" log line — no extra guard needed.
logger.info('app_check_enforced', { enforced: appCheckEnforced });

export const callableOptions: CallableOptions = {
  region: 'australia-southeast1',
  maxInstances: 5,
  timeoutSeconds: 60,
  memory: '256MiB',
  enforceAppCheck: appCheckEnforced,
  consumeAppCheckToken: false,
};

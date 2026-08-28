/**
 * Shared `onCall` options (plan §8.3 callable hardening checklist). Every
 * callable should spread this in, overriding only what genuinely differs
 * (e.g. a longer `timeoutSeconds` for imports).
 *
 * App Check enforcement is gated by an env flag so the emulator (which does
 * not mint App Check tokens by default) keeps working; production deploys set
 * `ENFORCE_APP_CHECK=true`.
 */
import type { CallableOptions } from 'firebase-functions/v2/https';

export const callableOptions: CallableOptions = {
  region: 'australia-southeast1',
  maxInstances: 5,
  timeoutSeconds: 60,
  memory: '256MiB',
  enforceAppCheck: process.env.ENFORCE_APP_CHECK === 'true',
};

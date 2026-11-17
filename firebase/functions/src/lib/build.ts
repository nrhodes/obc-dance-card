/**
 * What build is this? Stamped into the deploy bundle by `scripts/bundle.mjs`
 * (`git rev-parse HEAD` at bundle time, so a dispatched `deploy_ref` reports
 * the ref actually deployed). The post-deploy smoke test compares it with the
 * commit it just deployed, the same check it already makes against hosting's
 * `/version.json` — "upload accepted" and "new build serving" are not the
 * same thing. `typeof` on an undeclared identifier is safe, so the emulator,
 * tsx scripts and tests simply report "unknown".
 */
export const BUILD_COMMIT: string = typeof __OBC_BUILD_COMMIT__ === 'string' ? __OBC_BUILD_COMMIT__ : 'unknown';
export const BUILD_AT: string = typeof __OBC_BUILD_AT__ === 'string' ? __OBC_BUILD_AT__ : 'unknown';

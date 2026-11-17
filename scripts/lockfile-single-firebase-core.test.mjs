import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Exactly one `@firebase/app` may resolve in the workspace.
 *
 * The web app's Firebase components (`@firebase/functions`, `@firebase/auth`,
 * …) register themselves with whichever `@firebase/app` Node resolution
 * hands them. When two copies exist — firebase-admin's `@firebase/database-compat`
 * pins one patch version, the `firebase` web SDK another — a hoisted
 * component binds to the wrong core and the app dies at boot with
 * "Service functions is not available" (blank page; the firebase 13 bump,
 * 2026-11-17). The root `overrides["@firebase/app"]` keeps them on one
 * version; this test keeps the override honest after any dependency bump.
 */
test('package-lock resolves a single @firebase/app', () => {
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const copies = Object.entries(lock.packages)
    .filter(([path]) => /(^|\/)node_modules\/@firebase\/app$/.test(path))
    .map(([path, pkg]) => `${path}@${pkg.version}`);
  assert.deepEqual(copies, ['node_modules/@firebase/app@' + lock.packages['node_modules/@firebase/app'].version],
    `expected one @firebase/app, found: ${copies.join(', ')} — bump overrides["@firebase/app"] in package.json to the version the firebase SDK pins`);
});

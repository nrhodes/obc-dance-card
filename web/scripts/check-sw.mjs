#!/usr/bin/env node
/**
 * Build-output invariant check for the app's single service worker (plan
 * §16 Phase 5b, task brief D). Run standalone (`node scripts/check-sw.mjs`,
 * after `npm run build -w web`) or via `src/push/checkSw.test.ts`, which
 * shells out to this same script so it's covered by `npm test -w web`.
 *
 * Asserts:
 *  1. Exactly one service-worker-shaped file exists at the `dist/` root
 *     (`sw.js`) — no leftover second worker from an old config.
 *  2. It never imports a Workbox runtime-caching *strategy*
 *     (`StaleWhileRevalidate` / `NetworkFirst` / `NetworkOnly` /
 *     `CacheFirst` / `CacheOnly`). Since `src/push/sw.ts` never imports
 *     `workbox-strategies` or calls `registerRoute` for anything but the
 *     same-origin SPA-shell fallback, this structurally guarantees there is
 *     no runtime-caching route for *any* origin — including
 *     `*.googleapis.com` / `*.cloudfunctions.net` / `*.run.app`, which is
 *     the specific thing plan §8.1/§14.1 forbids ("never cache Firestore or
 *     function responses"). Checking for the absence of the strategy
 *     classes altogether is more robust than grepping for the literal
 *     string "googleapis" — that string legitimately appears in this
 *     project's `NavigationRoute` denylist prose/patterns without meaning a
 *     caching route exists.
 *  3. It contains evidence of both halves of the merged worker: the
 *     injected Workbox precache manifest (`revision` survives minification
 *     as an object key) and the push `notificationclick` handler (an event
 *     name, which must stay a literal string).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, '..', 'dist');
const SW_FILENAME = 'sw.js';

const FORBIDDEN_STRATEGY_TOKENS = ['StaleWhileRevalidate', 'NetworkFirst', 'NetworkOnly', 'CacheFirst', 'CacheOnly'];

function fail(message) {
  console.error(`check-sw: ${message}`);
  process.exitCode = 1;
}

export function checkServiceWorker(dir = distDir) {
  const errors = [];

  if (!existsSync(dir)) {
    errors.push(`dist directory not found at ${dir} — run \`npm run build -w web\` first.`);
    return errors;
  }

  const swPath = join(dir, SW_FILENAME);
  if (!existsSync(swPath)) {
    errors.push(`expected exactly one service worker at ${swPath}, but it does not exist.`);
    return errors;
  }

  // Guard against a second worker reappearing at the dist root (e.g. a
  // stray `firebase-messaging-sw.js` from a future edit reverting to two
  // registered workers). `registerSW.js` is not a worker — it's
  // vite-plugin-pwa's few-hundred-byte bootstrap script that calls
  // `navigator.serviceWorker.register('/sw.js')` from the page — so it's
  // explicitly allowed alongside the one real worker.
  const rootFiles = readdirSync(dir);
  const otherSwLikeFiles = rootFiles.filter(
    (name) => name.endsWith('.js') && /sw/i.test(name) && name !== SW_FILENAME && name !== 'registerSW.js',
  );
  if (otherSwLikeFiles.length > 0) {
    errors.push(`found extra service-worker-like file(s) at the dist root: ${otherSwLikeFiles.join(', ')} — there must be exactly one.`);
  }

  const content = readFileSync(swPath, 'utf8');

  for (const token of FORBIDDEN_STRATEGY_TOKENS) {
    if (content.includes(token)) {
      errors.push(`${SW_FILENAME} contains "${token}" — a Workbox runtime-caching strategy must never be registered (plan §8.1/§14.1: never cache Firestore/Functions responses).`);
    }
  }

  if (!content.includes('notificationclick')) {
    errors.push(`${SW_FILENAME} is missing a "notificationclick" handler — push deep-linking would be broken.`);
  }

  if (!content.includes('revision')) {
    errors.push(`${SW_FILENAME} shows no sign of an injected Workbox precache manifest ("revision" key) — app-shell precaching may not be wired up.`);
  }

  return errors;
}

// Only run as a CLI check when executed directly (not when imported by the
// vitest wrapper).
if (import.meta.url === `file://${process.argv[1]}`) {
  const errors = checkServiceWorker();
  if (errors.length === 0) {
    console.log(`check-sw: OK (${SW_FILENAME})`);
  } else {
    errors.forEach(fail);
  }
}

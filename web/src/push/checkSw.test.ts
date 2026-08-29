/**
 * Runs `scripts/check-sw.mjs` against the real build output, so the service
 * worker invariants (task brief D) are covered by `npm test -w web` and not
 * just a manual `node scripts/check-sw.mjs` after a build.
 *
 * This is a build-output check, not a unit test: it builds the app first if
 * `dist/` isn't already there (CI's "Build" step runs before "Unit tests",
 * so normally it already is — see `.github/workflows/ci.yml`), then imports
 * the checker as a plain module so failures show as real assertions rather
 * than a shelled-out exit code. It's slower than the rest of the suite by
 * design (a real Vite build); kept to this one file so it doesn't slow down
 * the rest of `npm test -w web` in watch mode.
 */
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS helper script (web/scripts/check-sw.mjs), not type-checked.
import { checkServiceWorker } from '../../scripts/check-sw.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..', '..');
const distDir = join(webRoot, 'dist');

describe('service worker build output', () => {
  it('has exactly one service worker, precaching the app shell, with no runtime-caching route', () => {
    if (!existsSync(distDir)) {
      // Keep this self-sufficient for a developer running `npm test -w web`
      // in isolation, without requiring them to remember a separate build
      // step first.
      execFileSync('npm', ['run', 'build'], { cwd: webRoot, stdio: 'inherit' });
    }
    const errors = checkServiceWorker(distDir);
    expect(errors).toEqual([]);
  }, 120_000);
});

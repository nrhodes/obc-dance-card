#!/usr/bin/env node
/**
 * Stamps the built site with the commit it was built from: `dist/version.json`
 * (plan §21 B12 item 9). The post-deploy smoke test polls this file to confirm
 * the release that is live is the one that was just deployed. Runs as the web
 * package's `postbuild`.
 *
 * The commit is `git rev-parse HEAD` — the checkout actually being built,
 * which on a rollback dispatch is NOT `GITHUB_SHA` — falling back to
 * `GITHUB_SHA`, then `"unknown"` (a build from a tarball). Never a build
 * failure.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, '..', 'dist');

function resolveCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return process.env.GITHUB_SHA || 'unknown';
  }
}

const version = { commit: resolveCommit(), builtAt: new Date().toISOString() };
mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, 'version.json'), JSON.stringify(version) + '\n');
console.log(`wrote dist/version.json (${version.commit.slice(0, 7)})`);

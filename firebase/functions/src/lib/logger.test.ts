/**
 * Regression guard (plan §3 rule 7 / §8.1 "Logs", phase 7a "Secrets and
 * logging audit"): every source file under `src/` must log through the
 * PII-safe `lib/logger.ts` wrapper, never `console.log`/`console.error`/
 * `console.warn` or the raw `firebase-functions/logger` module directly —
 * both bypass the wrapper's primitive-only field type, which is what makes
 * it hard to accidentally log an email, phone, code, or token.
 *
 * Two deliberate exceptions:
 *  - `lib/logger.ts` itself, which *is* the wrapper and legitimately imports
 *    `firebase-functions/logger`.
 *  - `email/provider.ts`'s `console.log` inside the `ConsoleEmailProvider`,
 *    which only runs when `!isDeployed()` (emulator/local/tests) and exists
 *    so a developer can read a login code off the terminal without querying
 *    Firestore — it is never reachable on a deployed Cloud Function.
 *
 * `firebase/seed/` and `firebase/scripts/` are one-off Node scripts outside
 * this package's `src/`, run directly with `tsx` rather than deployed as
 * Cloud Functions; they are out of scope for this scan (and out of scope for
 * `functionsLogger`, which only works inside a Cloud Functions runtime) and
 * use plain `console.log`/`console.error` deliberately, for a human running
 * them at a terminal.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = fileURLToPath(new URL('../..', import.meta.url)) + 'src';

const ALLOWLIST = new Set(['lib/logger.ts', 'email/provider.ts']);

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Strips `//` and `/* *\/` comments crudely — good enough to avoid false positives from doc comments like the one above. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('logging discipline — everything goes through lib/logger.ts', () => {
  const files = listTsFiles(SRC_DIR).map((f) => ({
    relPath: relative(SRC_DIR, f).split('\\').join('/'),
    code: stripComments(readFileSync(f, 'utf8')),
  }));

  it('found source files to scan (sanity check on the walker itself)', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('never calls console.log/console.error/console.warn directly, outside the allowlist', () => {
    const offenders = files
      .filter((f) => !ALLOWLIST.has(f.relPath))
      .filter((f) => /\bconsole\.(log|error|warn)\s*\(/.test(f.code))
      .map((f) => f.relPath);

    expect(offenders).toEqual([]);
  });

  it('never imports firebase-functions/logger directly, outside the allowlist', () => {
    const offenders = files
      .filter((f) => !ALLOWLIST.has(f.relPath))
      .filter((f) => /from\s+['"]firebase-functions\/logger['"]/.test(f.code))
      .map((f) => f.relPath);

    expect(offenders).toEqual([]);
  });

  it('the allowlist itself only names files that still exist (no stale entries)', () => {
    const known = new Set(files.map((f) => f.relPath));
    for (const allowed of ALLOWLIST) {
      expect(known.has(allowed)).toBe(true);
    }
  });
});

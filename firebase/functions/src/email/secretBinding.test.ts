/**
 * Static guard (security review 2026-11-17, T1): any deployed function that
 * can send email must bind the SMTP secrets, or `SMTP_USER.value()` /
 * `SMTP_PASS.value()` throws at runtime on the real provider. Two callables
 * shipped without the binding and failed *after* their transaction had
 * committed. Same walker/strip approach as `lib/logger.test.ts`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = fileURLToPath(new URL('../..', import.meta.url)) + 'src';
/** The provider itself; it is the thing being bound, not a caller. */
const ALLOWLIST = new Set(['email/provider.ts']);

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('email secret binding — every file that sends email binds SMTP_SECRETS', () => {
  const files = listTsFiles(SRC_DIR).map((f) => ({
    relPath: relative(SRC_DIR, f).split('\\').join('/'),
    code: stripComments(readFileSync(f, 'utf8')),
  }));

  const senders = files.filter((f) => !ALLOWLIST.has(f.relPath) && /\bgetEmailProvider\(\)/.test(f.code));

  it('found the known senders (sanity check on the scan itself)', () => {
    const paths = senders.map((f) => f.relPath).sort();
    expect(paths).toEqual(
      expect.arrayContaining([
        'auth/emailCode.ts',
        'entries/entries.ts',
        'notifications/dispatch.ts',
        'notifications/scheduled.ts',
        'visitors/signUp.ts',
      ]),
    );
  });

  it('every sender binds SMTP_SECRETS on its deployed function options', () => {
    const offenders = senders
      .filter((f) => !/secrets:\s*(\[[^\]]*\.\.\.SMTP_SECRETS|SMTP_SECRETS)/.test(f.code))
      .map((f) => f.relPath);
    expect(offenders).toEqual([]);
  });
});

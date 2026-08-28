import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { parseInput } from './parseInput.js';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.includes('.test.')) out.push(p);
  }
  return out;
}

describe('parseInput', () => {
  it('maps a zod failure to invalid-argument naming only the issue path', () => {
    const schema = z.object({ email: z.string().email() });
    try {
      parseInput(schema, { email: 'secret-not-an-email' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(HttpsError);
      const e = err as HttpsError;
      expect(e.code).toBe('invalid-argument');
      expect(e.message).toContain('email');
      expect(e.message).not.toContain('secret-not-an-email');
    }
  });

  it('no callable calls Schema.parse(req.data) directly (plan §8.3)', () => {
    const src = fileURLToPath(new URL('..', import.meta.url));
    const offenders = walk(src).filter((f) => /\w+Schema\.parse\(req\.data\)/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

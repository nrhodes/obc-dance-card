import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('members.csv template', () => {
  it('web/public/templates/members.csv is byte-identical to shared/templates/members.csv', () => {
    const sharedPath = resolve(__dirname, '..', '..', '..', 'shared', 'templates', 'members.csv');
    const publicPath = resolve(__dirname, '..', '..', 'public', 'templates', 'members.csv');

    const sharedBuf = readFileSync(sharedPath);
    const publicBuf = readFileSync(publicPath);

    expect(publicBuf.equals(sharedBuf)).toBe(true);
  });
});

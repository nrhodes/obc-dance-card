import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEMPLATE_FILES = ['members.csv', 'weekdays.csv', 'series.csv', 'singles.csv'];

describe.each(TEMPLATE_FILES)('%s template', (file) => {
  it(`web/public/templates/${file} is byte-identical to shared/templates/${file}`, () => {
    const sharedPath = resolve(__dirname, '..', '..', '..', 'shared', 'templates', file);
    const publicPath = resolve(__dirname, '..', '..', 'public', 'templates', file);

    const sharedBuf = readFileSync(sharedPath);
    const publicBuf = readFileSync(publicPath);

    expect(publicBuf.equals(sharedBuf)).toBe(true);
  });
});

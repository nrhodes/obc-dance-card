/**
 * `index.html` and the PWA manifest (`vite.config.ts`) cannot import
 * `@obc/shared`, so they spell the product's name literally. This keeps them
 * in step with `PRODUCT_NAME` / `PRODUCT_SHORT_NAME` (plan §21 B14.8 stage 3)
 * and stops a club's name creeping back into either.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRODUCT_NAME, PRODUCT_SHORT_NAME } from '@obc/shared';

const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8');

describe('product name outside the bundle', () => {
  it('index.html is titled with the product name', () => {
    expect(read('index.html')).toContain(`<title>${PRODUCT_NAME}</title>`);
  });

  it('the PWA manifest uses the product name and short name', () => {
    const config = read('vite.config.ts');
    expect(config).toContain(`name: '${PRODUCT_NAME}',`);
    expect(config).toContain(`short_name: '${PRODUCT_SHORT_NAME}',`);
  });

  it('neither names a particular club', () => {
    expect(read('index.html')).not.toMatch(/Orewa/);
    expect(read('vite.config.ts')).not.toMatch(/Orewa/);
  });
});

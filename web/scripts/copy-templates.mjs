#!/usr/bin/env node
/**
 * Keeps `web/public/templates/*.csv` byte-identical to `shared/templates/*.csv`
 * (the files the admin import screens link to for download). Run before
 * `dev`/`build`; `src/lib/templates.test.ts` also asserts every file matches
 * so a forgotten re-copy fails CI.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', '..', 'shared', 'templates');
const destDir = join(here, '..', 'public', 'templates');

const TEMPLATE_FILES = ['members.csv', 'weekdays.csv', 'series.csv', 'singles.csv'];

mkdirSync(destDir, { recursive: true });
for (const file of TEMPLATE_FILES) {
  const src = join(srcDir, file);
  const dest = join(destDir, file);
  copyFileSync(src, dest);
  console.log(`copied ${src} -> ${dest}`);
}

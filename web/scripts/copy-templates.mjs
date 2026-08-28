#!/usr/bin/env node
/**
 * Keeps `web/public/templates/members.csv` byte-identical to
 * `shared/templates/members.csv` (the file the admin import screen links to
 * for download). Run before `dev`/`build`; `src/lib/templates.test.ts` also
 * asserts the two files match so a forgotten re-copy fails CI.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'shared', 'templates', 'members.csv');
const destDir = join(here, '..', 'public', 'templates');
const dest = join(destDir, 'members.csv');

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`copied ${src} -> ${dest}`);

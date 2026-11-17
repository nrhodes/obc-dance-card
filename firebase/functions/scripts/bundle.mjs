/**
 * Builds the self-contained deploy directory `firebase/functions-deploy/`.
 *
 * Cloud Functions runs `npm install` on Google's side, where the workspace
 * package `@obc/shared` does not exist (npm E404). So we bundle the source
 * with esbuild — inlining `@obc/shared` and `zod` — and emit a minimal
 * package.json listing only real npm runtime dependencies. Env files
 * (`.env`, `.env.<project>`, `.secret.local`) are copied alongside so the
 * Firebase CLI and emulator pick them up as usual.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const functionsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(functionsDir, '..', 'functions-deploy');
const pkg = JSON.parse(readFileSync(join(functionsDir, 'package.json'), 'utf8'));

const RUNTIME_DEPS = ['firebase-admin', 'firebase-functions', 'nodemailer', 'papaparse'];

// Stamp the build so `version` (src/version.ts) can report it and the
// post-deploy smoke test can confirm the new bundle is the one serving.
// `git rev-parse HEAD` first — in the deploy job that is the checked-out
// `deploy_ref`, whereas GITHUB_SHA is the dispatched main head.
function resolveCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: functionsDir, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return process.env.GITHUB_SHA || 'unknown';
  }
}
const buildCommit = resolveCommit();
const buildAt = new Date().toISOString();
const external = RUNTIME_DEPS.flatMap((d) => [d, `${d}/*`]);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'lib'), { recursive: true });

await build({
  entryPoints: [join(functionsDir, 'src', 'index.ts')],
  outfile: join(outDir, 'lib', 'index.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external,
  define: {
    __OBC_BUILD_COMMIT__: JSON.stringify(buildCommit),
    __OBC_BUILD_AT__: JSON.stringify(buildAt),
  },
  logLevel: 'warning',
  banner: {
    // Some CommonJS deps reached through the bundle expect `require`.
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

const dependencies = Object.fromEntries(RUNTIME_DEPS.map((d) => [d, pkg.dependencies[d]]));
for (const [name, version] of Object.entries(dependencies)) {
  if (!version) throw new Error(`Runtime dependency ${name} is missing from functions/package.json`);
}
writeFileSync(
  join(outDir, 'package.json'),
  JSON.stringify(
    {
      name: 'obc-dance-card-functions',
      private: true,
      type: 'module',
      main: 'lib/index.js',
      engines: pkg.engines,
      dependencies,
    },
    null,
    2,
  ) + '\n',
);

for (const name of readdirSync(functionsDir)) {
  if ((name.startsWith('.env') && name !== '.env.example') || name === '.secret.local') {
    cpSync(join(functionsDir, name), join(outDir, name));
  }
}
if (!existsSync(join(outDir, 'lib', 'index.js'))) throw new Error('bundle missing');
console.log(`bundled -> ${outDir} (deps: ${RUNTIME_DEPS.join(', ')}; build ${buildCommit.slice(0, 7)})`);

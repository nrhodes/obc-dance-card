/**
 * `version` — a public, read-only HTTP endpoint reporting which build of the
 * functions is serving: `{ commit, builtAt }`. Exists for the post-deploy
 * smoke test (plan §21 B12 item 9), which otherwise could only prove that
 * *a* callable was loaded, not *which* build. Deliberately not a callable:
 * every callable sits behind App Check, and the smoke test runs with no
 * attestation. It discloses nothing that is not already public — the
 * repository is public and hosting's `/version.json` already reports the
 * same commit for the web app. No auth, no database, no logging, GET/HEAD
 * only, `no-store` so a CDN can never answer for an old build.
 */
import { onRequest, type Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { BUILD_AT, BUILD_COMMIT } from './lib/build.js';

export function versionHandler(req: Request, res: Response): void {
  const method = (req.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    res.status(405).set('Allow', 'GET, HEAD').send('Method not allowed');
    return;
  }
  res
    .status(200)
    .set('Content-Type', 'application/json; charset=utf-8')
    .set('Cache-Control', 'no-store')
    .set('X-Content-Type-Options', 'nosniff');
  if (method === 'HEAD') res.end();
  else res.send(JSON.stringify({ commit: BUILD_COMMIT, builtAt: BUILD_AT }));
}

export const version = onRequest(
  { region: 'australia-southeast1', maxInstances: 2, timeoutSeconds: 10, memory: '256MiB' },
  versionHandler,
);

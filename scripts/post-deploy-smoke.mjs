#!/usr/bin/env node
/**
 * Post-deploy smoke test (plan §21 B12 item 9). The Firebase CLI exiting 0
 * only means the upload was accepted; this checks that what is live actually
 * works:
 *
 *   1. Hosting serves the app shell (200 + the expected <title>).
 *   2. The release that is live is the commit just deployed (`/version.json`,
 *      written by `web/scripts/write-version.mjs`), polled because Hosting's
 *      CDN can lag a few seconds behind the deploy.
 *   3. The functions bundle started: one unauthenticated request to a callable
 *      gets a well-formed callable response. With App Check enforced that is
 *      a 401 `UNAUTHENTICATED` error — a *pass*: the platform only produces it
 *      once the function's code has loaded. A 404, a 5xx, an HTML error page
 *      or a timeout is the failure (e.g. a missing runtime dependency).
 *
 * The probe sends no member data and is rejected before any handler runs, so
 * it cannot touch the per-email/per-IP login-code rate limits.
 *
 * Usage:
 *   node scripts/post-deploy-smoke.mjs --project obc-dance-card [--expect-sha <sha>]
 *     [--base-url https://<project>.web.app] [--region australia-southeast1]
 *     [--callable requestLoginCode] [--timeout-seconds 120]
 *
 * Exit code 0 = all checks passed; 1 = a check failed; 2 = bad usage.
 */

const EXPECTED_TITLE = 'Orewa Bridge Club — Dance Card';
/** Callable error statuses that prove the function is deployed and loaded. */
const LOADED_ERROR_STATUSES = new Set(['UNAUTHENTICATED', 'INVALID_ARGUMENT', 'FAILED_PRECONDITION', 'RESOURCE_EXHAUSTED']);
const REQUEST_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 5_000;

export function parseArgs(argv) {
  const args = { region: 'australia-southeast1', callable: 'requestLoginCode', timeoutSeconds: 120 };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    if (argv[i] === '--project') args.project = value;
    else if (argv[i] === '--base-url') args.baseUrl = value;
    else if (argv[i] === '--expect-sha') args.expectSha = value;
    else if (argv[i] === '--region') args.region = value;
    else if (argv[i] === '--callable') args.callable = value;
    else if (argv[i] === '--timeout-seconds') args.timeoutSeconds = Number(value);
    else throw new Error(`Unknown argument: ${argv[i]}`);
    i++;
  }
  if (!args.project) throw new Error('--project is required');
  if (!Number.isFinite(args.timeoutSeconds) || args.timeoutSeconds <= 0) throw new Error('--timeout-seconds must be a positive number');
  args.baseUrl = (args.baseUrl ?? `https://${args.project}.web.app`).replace(/\/+$/, '');
  return args;
}

/**
 * Classifies a callable's HTTP response. Exported for the unit test.
 * @param {number} status
 * @param {string} bodyText
 * @returns {{ ok: boolean, detail: string }}
 */
/**
 * The functions' own `version` endpoint (src/version.ts). Mirrors the
 * hosting `/version.json` check: a 200 with a `commit` that matches the
 * deployed SHA proves the new functions bundle is the one serving, not just
 * that *a* function answered.
 */
export function classifyVersionResponse(status, bodyText, expectSha) {
  if (status === 404) return { ok: false, detail: 'HTTP 404 — the version endpoint is not deployed' };
  if (status !== 200) return { ok: false, detail: `HTTP ${status} from the version endpoint` };
  let commit;
  try {
    commit = JSON.parse(bodyText).commit;
  } catch {
    return { ok: false, detail: 'version endpoint did not return JSON' };
  }
  if (typeof commit !== 'string') return { ok: false, detail: 'version endpoint has no commit field' };
  if (commit === 'unknown') return { ok: false, detail: 'functions report build "unknown" — the bundle was not stamped' };
  if (!expectSha) return { ok: true, detail: `functions build ${commit.slice(0, 7)} (no --expect-sha given)` };
  if (commit !== expectSha) return { ok: false, detail: `functions build ${commit.slice(0, 7)}, expected ${expectSha.slice(0, 7)}` };
  return { ok: true, detail: `functions build ${commit.slice(0, 7)} matches` };
}

export function classifyCallableResponse(status, bodyText) {
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { ok: false, detail: `HTTP ${status} with a non-JSON body — the function is missing or failed to start` };
  }
  if (status >= 500) return { ok: false, detail: `HTTP ${status} (${body?.error?.status ?? 'no status'}) — the function is failing` };
  if (status === 404) return { ok: false, detail: 'HTTP 404 — the function is not deployed' };
  if (body && typeof body === 'object' && 'result' in body) return { ok: true, detail: `HTTP ${status}, returned a result` };
  const errorStatus = body?.error?.status;
  if (LOADED_ERROR_STATUSES.has(errorStatus)) return { ok: true, detail: `HTTP ${status} ${errorStatus} (expected rejection — the function is loaded)` };
  return { ok: false, detail: `HTTP ${status} with unexpected callable status ${JSON.stringify(errorStatus)}` };
}

async function fetchText(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'follow' });
  return { status: res.status, text: await res.text() };
}

/** Retries `check` until it returns `{ ok: true }` or the deadline passes. */
async function poll(name, deadline, check) {
  let last = { ok: false, detail: 'not attempted' };
  for (;;) {
    try {
      last = await check();
    } catch (err) {
      last = { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
    if (last.ok || Date.now() + POLL_INTERVAL_MS > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  console.log(`${last.ok ? 'PASS' : 'FAIL'}  ${name}: ${last.detail}`);
  return last.ok;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  }
  const deadline = Date.now() + args.timeoutSeconds * 1000;
  const cacheBust = `?smoke=${Date.now()}`;
  console.log(`Smoke test: ${args.baseUrl} (project ${args.project})`);

  const hostingOk = await poll('hosting serves the app', deadline, async () => {
    const { status, text } = await fetchText(`${args.baseUrl}/${cacheBust}`);
    if (status !== 200) return { ok: false, detail: `HTTP ${status}` };
    if (!text.includes(`<title>${EXPECTED_TITLE}</title>`)) return { ok: false, detail: 'HTTP 200 but the expected <title> is missing' };
    return { ok: true, detail: 'HTTP 200 with the expected <title>' };
  });

  const versionOk = await poll('deployed version', deadline, async () => {
    const { status, text } = await fetchText(`${args.baseUrl}/version.json${cacheBust}`);
    if (status !== 200) return { ok: false, detail: `version.json returned HTTP ${status}` };
    let commit;
    try {
      commit = JSON.parse(text).commit;
    } catch {
      return { ok: false, detail: 'version.json is not JSON (the SPA fallback served index.html?)' };
    }
    if (typeof commit !== 'string') return { ok: false, detail: 'version.json has no commit field' };
    if (!args.expectSha) return { ok: true, detail: `live commit ${commit.slice(0, 7)} (no --expect-sha given)` };
    if (commit !== args.expectSha) return { ok: false, detail: `live commit ${commit.slice(0, 7)}, expected ${args.expectSha.slice(0, 7)}` };
    return { ok: true, detail: `live commit ${commit.slice(0, 7)} matches` };
  });

  const functionsOk = await poll(`callable ${args.callable} is loaded`, deadline, async () => {
    const url = `https://${args.region}-${args.project}.cloudfunctions.net/${args.callable}`;
    const { status, text } = await fetchText(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: {} }),
    });
    return classifyCallableResponse(status, text);
  });

  const functionsVersionOk = await poll('functions version', deadline, async () => {
    const url = `https://${args.region}-${args.project}.cloudfunctions.net/version${cacheBust}`;
    const { status, text } = await fetchText(url);
    return classifyVersionResponse(status, text, args.expectSha);
  });

  if (hostingOk && versionOk && functionsOk && functionsVersionOk) {
    console.log('Smoke test passed.');
    return;
  }
  console.error('Smoke test FAILED — the deploy went out but the checks above did not pass. Roll back with a manual dispatch at the previous commit (docs/ops-runbook.md).');
  process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href;
if (isMain) await main();

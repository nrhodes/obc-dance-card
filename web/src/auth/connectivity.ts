/**
 * Why has the member record not arrived?
 *
 * When Firestore's transport is refused by something *in the browser* (an ad
 * or privacy blocker with a rule for googleapis.com, a corporate filter), the
 * Firestore SDK does not surface an error — it retries quietly, forever — so
 * `onSnapshot` never calls either callback and the app would sit on
 * "Loading…" indefinitely (incident 2026-11-17: `ERR_BLOCKED_BY_CLIENT` on
 * firestore.googleapis.com from a Brave extension; sign-in succeeded, the
 * member read never happened).
 *
 * After a stall, two probes tell the cases apart: our own origin, and Google's
 * API host. Own origin reachable but googleapis not → something is blocking
 * the latter selectively ('blocked'). Anything else → 'unavailable' (offline,
 * outage, captive portal). A `no-cors` fetch resolves with an opaque response
 * whenever the host answered at all; a blocker rejects it with a TypeError.
 */
export type StallCause = 'blocked' | 'unavailable';

const PROBE_TIMEOUT_MS = 4000;

async function reachable(url: string, init: RequestInit): Promise<boolean> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(url, { ...init, cache: 'no-store', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function classifyStall(fetchImpl: typeof fetch = fetch): Promise<StallCause> {
  const probe = (url: string, init: RequestInit) =>
    fetchImpl === fetch ? reachable(url, init) : fetchImpl(url, init).then(() => true, () => false);
  const [ownOrigin, googleApis] = await Promise.all([
    probe(`/version.json?probe=${Date.now()}`, {}),
    probe('https://firestore.googleapis.com/', { mode: 'no-cors' }),
  ]);
  return ownOrigin && !googleApis ? 'blocked' : 'unavailable';
}

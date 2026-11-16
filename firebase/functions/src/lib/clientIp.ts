/**
 * Client IP for per-IP rate limiting (plan §8.1; security review 2026-11-16, M1).
 *
 * `x-forwarded-for` is a comma-separated list that *grows to the right*: each
 * proxy appends the address it saw the request come from. Anything a client
 * puts in the header itself therefore arrives at the **left**, before the
 * entries Google's front end appends. Trusting the first entry (the previous
 * behaviour) let a caller choose its own bucket — bypassing per-IP limits by
 * rotating a fabricated header, or burning a victim address's bucket (the
 * club's Wi-Fi NAT, say) by naming it.
 *
 * The trustworthy entry is the one appended by infrastructure we control the
 * count of:
 *  - a callable on Cloud Run is reached directly, so Google appends exactly
 *    one entry — the real client — and `trustedHops = 0` picks the last;
 *  - the iCal feed is reached through a Firebase Hosting rewrite, which adds
 *    one hop between the client and the function, so `trustedHops = 1` picks
 *    the second-to-last.
 * When the header holds fewer entries than `trustedHops + 1` (a direct call
 * to an endpoint configured for the Hosting path, or an honest client with
 * no upstream proxies) the leftmost surviving entry is used — correct for
 * every honest topology, and the hop counts are env-tunable
 * (`TRUSTED_PROXY_HOPS`, `ICAL_TRUSTED_PROXY_HOPS`) should the platform add
 * or remove a hop. The feed logs the entry count (never an address) so the
 * assumption can be checked against production.
 */

export type ForwardedForHeader = string | string[] | undefined;

/** Splits one or several `x-forwarded-for` header values into trimmed, non-empty entries, left to right. */
export function forwardedForEntries(header: ForwardedForHeader): string[] {
  const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * The client address `trustedHops` from the right of `x-forwarded-for`, or
 * `fallbackIp` (the connection address) when the header is absent.
 */
export function clientIpFromForwardedFor(
  header: ForwardedForHeader,
  fallbackIp: string | undefined,
  trustedHops: number,
): string {
  const entries = forwardedForEntries(header);
  if (entries.length === 0) return fallbackIp ?? 'unknown';
  const hops = Number.isFinite(trustedHops) && trustedHops > 0 ? Math.floor(trustedHops) : 0;
  const index = Math.max(0, entries.length - 1 - hops);
  return entries[index]!;
}

/** `TRUSTED_PROXY_HOPS` etc. — a non-negative integer, else the default. */
export function trustedHopsFromEnv(name: string, defaultHops: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : defaultHops;
}

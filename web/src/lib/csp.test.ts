/**
 * Static checks on the hosting CSP (plan §14.1, §18 checklist item 10;
 * Phase 7b task deliverable G). Parses `firebase/firebase.json` directly so
 * a future edit that reintroduces `unsafe-eval`, adds `'unsafe-inline'`
 * outside `style-src`, or loosens `frame-ancestors`/`object-src` fails this
 * test — the same "read the actual file" approach `styles.test.ts` uses.
 *
 * Not under `firebase/functions/` (this phase's functions-side file
 * ownership is scoped to `notifications/dispatch.ts` only) — reading
 * `firebase.json` from a `web/` test is a read-only cross-workspace check,
 * not an edit to a functions file.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const firebaseJsonPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'firebase',
  'firebase.json',
);

interface Header {
  key: string;
  value: string;
}
interface HostingConfig {
  hosting: { headers: Array<{ source: string; headers: Header[] }> };
}

function readHeaders(): Header[] {
  const config = JSON.parse(readFileSync(firebaseJsonPath, 'utf8')) as HostingConfig;
  const rule = config.hosting.headers.find((h) => h.source === '**');
  expect(rule, 'no "**" hosting header rule found').toBeDefined();
  return rule!.headers;
}

function readCsp(): string {
  const csp = readHeaders().find((h) => h.key === 'Content-Security-Policy');
  expect(csp, 'no Content-Security-Policy header found on the "**" rule').toBeDefined();
  return csp!.value;
}

function directive(csp: string, name: string): string {
  const match = new RegExp(`(?:^|;)\\s*${name}\\s+([^;]*)`).exec(csp);
  expect(match, `${name} directive not found in CSP`).not.toBeNull();
  return match![1]!.trim();
}

describe('hosting CSP (firebase/firebase.json)', () => {
  const csp = readCsp();

  it('has no unsafe-eval anywhere', () => {
    expect(csp).not.toMatch(/unsafe-eval/);
  });

  it("uses 'unsafe-inline' only in style-src", () => {
    const directives = csp.split(';').map((d) => d.trim());
    const withUnsafeInline = directives.filter((d) => d.includes("'unsafe-inline'"));
    expect(withUnsafeInline).toEqual([expect.stringMatching(/^style-src\b/)]);
  });

  it('sets frame-ancestors to none', () => {
    expect(directive(csp, 'frame-ancestors')).toBe("'none'");
  });

  it('sets object-src to none', () => {
    expect(directive(csp, 'object-src')).toBe("'none'");
  });

  it('restricts worker-src to self (task deliverable G)', () => {
    expect(directive(csp, 'worker-src')).toBe("'self'");
  });

  it('restricts manifest-src to self (task deliverable G)', () => {
    expect(directive(csp, 'manifest-src')).toBe("'self'");
  });

  it('the manifest is served under the same "**" rule, so the CSP applies to it too', () => {
    const config = JSON.parse(readFileSync(firebaseJsonPath, 'utf8')) as HostingConfig;
    const rule = config.hosting.headers.find((h) => h.source === '**');
    // A single catch-all rule (rather than a narrower source pattern) is
    // exactly what guarantees the manifest gets the same headers as every
    // other path — assert that shape explicitly so a future narrowing of
    // `source` (e.g. excluding *.webmanifest) is caught here.
    expect(rule!.source).toBe('**');
  });
});

/**
 * Security review 2026-11-16, L5: `connect-src` must name only hosts this app
 * actually talks to. A wildcard over every Cloud Run / Cloud Functions
 * customer (`*.run.app`, `*.cloudfunctions.net`) would hand any future XSS an
 * exfiltration path; Realtime Database (`firebaseio.com`) is not used at all.
 */
describe('hosting CSP connect-src pins (security review L5)', () => {
  const csp = readCsp();
  const connect = directive(csp, 'connect-src');

  it('names the project function hosts explicitly rather than every GCP customer', () => {
    expect(connect).toContain('https://australia-southeast1-obc-dance-card.cloudfunctions.net');
    expect(connect).not.toMatch(/\*\.cloudfunctions\.net/);
    expect(connect).not.toMatch(/run\.app/);
  });

  it('does not allow Realtime Database hosts the app never uses', () => {
    expect(connect).not.toMatch(/firebaseio\.com/);
  });

  it("allows only 'self', *.googleapis.com, the function hosts and www.google.com (reCAPTCHA)", () => {
    const allowed = connect.split(/\s+/).filter((t) => t !== "'self'");
    for (const host of allowed) {
      expect(host).toMatch(
        /^https:\/\/(\*\.googleapis\.com|australia-southeast1-obc-dance-card(-dev)?\.cloudfunctions\.net|www\.google\.com)$/,
      );
    }
  });
});

describe('hosting isolation headers (security review L5)', () => {
  const headers = readHeaders();
  const value = (key: string) => headers.find((h) => h.key === key)?.value;

  it('sets Cross-Origin-Opener-Policy: same-origin (no OAuth popups or cross-origin openers are needed)', () => {
    expect(value('Cross-Origin-Opener-Policy')).toBe('same-origin');
  });

  it('keeps clickjacking and transport protections', () => {
    expect(value('X-Frame-Options')).toBe('DENY');
    expect(value('Strict-Transport-Security')).toMatch(/max-age=\d+; includeSubDomains/);
  });
});

describe('hosting cache headers (incident 2026-11-17: a stale app shell outlived a deploy)', () => {
  const config = JSON.parse(readFileSync(firebaseJsonPath, 'utf8')) as HostingConfig;
  const rules = config.hosting.headers;
  const catchAll = rules.find((h) => h.source === '**');
  const assets = rules.find((h) => h.source === '/assets/**');

  it('the shell, sw.js and manifest always revalidate', () => {
    const cc = catchAll?.headers.find((h) => h.key === 'Cache-Control');
    expect(cc?.value).toBe('no-cache');
  });

  it('content-hashed assets are immutable for a year', () => {
    const cc = assets?.headers.find((h) => h.key === 'Cache-Control');
    expect(cc?.value).toBe('public, max-age=31536000, immutable');
  });

  it('the assets rule comes after the catch-all, so its Cache-Control wins', () => {
    expect(rules.indexOf(assets!)).toBeGreaterThan(rules.indexOf(catchAll!));
  });
});


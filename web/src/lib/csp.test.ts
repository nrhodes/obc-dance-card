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

function readCsp(): string {
  const config = JSON.parse(readFileSync(firebaseJsonPath, 'utf8')) as HostingConfig;
  const rule = config.hosting.headers.find((h) => h.source === '**');
  expect(rule, 'no "**" hosting header rule found').toBeDefined();
  const csp = rule!.headers.find((h) => h.key === 'Content-Security-Policy');
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

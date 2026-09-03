/**
 * Static checks on `styles.css` for the plan §14.1 accessibility rules
 * (Phase 7b task deliverable B): base font 18px, minimum 48px tap targets.
 * Parses the actual stylesheet text rather than re-asserting values in
 * isolation, so a future edit that silently shrinks a tap target or the
 * base font fails this test.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'styles.css');
const css = readFileSync(cssPath, 'utf8');

/** Every `min-height` declaration's raw value (e.g. `48px`, `var(--tap-target)`). */
function minHeightValues(source: string): string[] {
  return [...source.matchAll(/min-height:\s*([^;]+);/g)].map((m) => m[1]!.trim());
}

describe('styles.css accessibility rules', () => {
  it('sets the base font size to 18px', () => {
    const match = /--font-size-base:\s*(\d+)px/.exec(css);
    expect(match, '--font-size-base custom property not found').not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(18);
  });

  it('defines the shared tap-target size as at least 48px', () => {
    const match = /--tap-target:\s*(\d+)px/.exec(css);
    expect(match, '--tap-target custom property not found').not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(48);
  });

  it('every button/field/link tap target uses the shared >=48px --tap-target variable, or an explicit px value that is itself >=48px', () => {
    const values = minHeightValues(css);
    // e.g. `body { min-height: 100vh }` is a full-viewport rule, not a tap
    // target — everything else in this stylesheet's `min-height` uses.
    //
    // `.month-cell-compact` (plan §21 B4, Calendar Year view) is a
    // deliberate, documented exception: 12 months' worth of Mon-Fri day
    // cells at the usual 48px minimum would not fit on a phone screen, and
    // the Year view exists purely as a compact "spot the open days" glance —
    // the Month and List views (this app's primary booking surfaces) keep
    // full 48px cells. See the CSS comment above `.month-cell-compact`.
    const KNOWN_EXCEPTIONS = new Set(['100vh', '22px']);
    const tapTargetCandidates = values.filter((v) => !KNOWN_EXCEPTIONS.has(v));
    expect(
      tapTargetCandidates.length,
      'no tap-target min-height rules found — did styles.css change shape?',
    ).toBeGreaterThan(5);
    for (const value of tapTargetCandidates) {
      if (value === 'var(--tap-target)') continue; // asserted >= 48px above
      const px = /^(\d+(?:\.\d+)?)px$/.exec(value);
      expect(
        px,
        `unexpected min-height value "${value}" on a tap target — update this test if it's intentional`,
      ).not.toBeNull();
      expect(Number(px![1])).toBeGreaterThanOrEqual(48);
    }
  });

  it('has a visible focus ring rule (:focus-visible)', () => {
    expect(css).toMatch(/:focus-visible\s*{[^}]*outline:/);
  });

  it('respects prefers-reduced-motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)/);
  });
});

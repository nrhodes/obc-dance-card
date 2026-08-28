import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * String-level regression guard (plan §17 / §18): the rules must never grow a
 * client `create`/`update`/`delete`/`write` allow rule other than the single
 * `notifications` "toggle read/readAt" update, and explicit `: if false`
 * denials. This is a blunt, deliberately non-semantic check — it exists to
 * fail loudly if someone "temporarily" loosens a rule to make a test pass.
 */

const rulesPath = fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const rulesText = readFileSync(rulesPath, 'utf8');

const MUTATING_VERBS = ['create', 'update', 'delete', 'write'];

// Every "allow <verb[, verb...]>: if <condition>;" statement, any verb combo.
const ALLOW_LINE_RE = /allow\s+([a-z]+(?:\s*,\s*[a-z]+)*)\s*:\s*if\s+([^;]+);/g;

/** Every allow rule that grants at least one of create/update/delete/write. */
function findMutatingAllowLines(text: string): { verbs: string; condition: string }[] {
  const lines: { verbs: string; condition: string }[] = [];
  for (const match of text.matchAll(ALLOW_LINE_RE)) {
    const verbs = match[1]!
      .split(',')
      .map((v) => v.trim())
      .filter((v) => MUTATING_VERBS.includes(v));
    if (verbs.length > 0) {
      lines.push({ verbs: verbs.join(','), condition: match[2]!.trim() });
    }
  }
  return lines;
}

describe('firestore.rules — no client writes beyond the notifications exception', () => {
  it('every create/update/delete/write allow rule is either "if false" or the notifications read/readAt toggle', () => {
    const mutating = findMutatingAllowLines(rulesText);
    expect(mutating.length).toBeGreaterThan(0); // sanity: the regex actually matched something

    const offenders = mutating.filter((line) => {
      if (line.condition === 'false') return false; // explicit denial: fine
      // The one allowed exception: notifications owner update of read/readAt.
      const isNotificationsUpdate =
        line.verbs === 'update' &&
        /affectedKeys\(\)\.hasOnly\(\['read',\s*'readAt'\]\)/.test(line.condition);
      return !isNotificationsUpdate;
    });

    expect(offenders).toEqual([]);
  });

  it('contains exactly one non-false mutating allow rule (the notifications exception)', () => {
    const mutating = findMutatingAllowLines(rulesText);
    const nonFalse = mutating.filter((line) => line.condition !== 'false');
    expect(nonFalse).toHaveLength(1);
    expect(nonFalse[0]!.verbs).toBe('update');
  });
});

import { describe, expect, it } from 'vitest';

/**
 * Phase 0 smoke test: the shared package resolves and its runtime helpers work
 * from inside the functions workspace. Callable/trigger tests arrive with their
 * features in later phases (run against the emulator via firebase-functions-test).
 */
describe('functions ↔ shared wiring', () => {
  it('imports @obc/shared and runs a validator', async () => {
    const { parseWeekday, paths } = await import('@obc/shared');
    expect(parseWeekday('Monday')).toBe('monday');
    expect(paths.member('abc')).toBe('members/abc');
  });
});

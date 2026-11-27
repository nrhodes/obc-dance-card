import { describe, expect, it } from 'vitest';

/**
 * Phase 0 smoke test: the shared package resolves and its runtime helpers work
 * from inside the functions workspace. Callable/trigger tests arrive with their
 * features in later phases (run against the emulator; see src/testing/README.md).
 */
describe('functions ↔ shared wiring', () => {
  it('imports @obc/shared and runs a validator', async () => {
    const { parseWeekday, clubPaths, DEFAULT_CLUB_ID } = await import('@obc/shared');
    expect(parseWeekday('Monday')).toBe('monday');
    // Stage 1a (plan §21 B14.8): the club is threaded through, the data has not moved.
    expect(clubPaths(DEFAULT_CLUB_ID).member('abc')).toBe('members/abc');
  });
});

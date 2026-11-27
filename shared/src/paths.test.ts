import { describe, expect, it } from 'vitest';
import { DEFAULT_CLUB_ID, clubPaths, paths } from './paths.js';

describe('clubPaths', () => {
  it('carries the club it was built for', () => {
    expect(clubPaths('some-club').clubId).toBe('some-club');
  });

  /**
   * Stage 1a (plan §21 B14.8): the club is threaded through the code but the
   * data has not moved, so every club-owned path is still top-level. Stage 1b
   * changes these expectations to `clubs/{clubId}/…` — deliberately, in the
   * same change as the data migration and the rules.
   */
  it('still spells today’s top-level locations', () => {
    const cp = clubPaths(DEFAULT_CLUB_ID);
    expect(cp.member('u1')).toBe('members/u1');
    expect(cp.entries()).toBe('entries');
    expect(cp.session(2027, 's1')).toBe('programmes/2027/sessions/s1');
    expect(cp.weekday(2027, 'monday')).toBe('programmes/2027/weekdays/monday');
    expect(cp.auditLogEntry('a1')).toBe('auditLog/a1');
  });

  it('keeps person-level paths out of any club', () => {
    expect(paths.memberPrivate('u1')).toBe('memberPrivate/u1');
    expect(paths.notification('n1')).toBe('notifications/n1');
  });
});

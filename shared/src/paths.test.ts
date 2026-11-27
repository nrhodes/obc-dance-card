import { describe, expect, it } from 'vitest';
import { DEFAULT_CLUB_ID, clubPaths, paths } from './paths.js';

describe('clubPaths', () => {
  it('carries the club it was built for', () => {
    expect(clubPaths('some-club').clubId).toBe('some-club');
  });

  it('puts everything a club owns under clubs/{clubId}', () => {
    const cp = clubPaths(DEFAULT_CLUB_ID);
    expect(cp.member('u1')).toBe('clubs/orewa/members/u1');
    expect(cp.entries()).toBe('clubs/orewa/entries');
    expect(cp.session(2027, 's1')).toBe('clubs/orewa/programmes/2027/sessions/s1');
    expect(cp.weekday(2027, 'monday')).toBe('clubs/orewa/programmes/2027/weekdays/monday');
    expect(cp.auditLogEntry('a1')).toBe('clubs/orewa/auditLog/a1');
    expect(clubPaths('another').entries()).toBe('clubs/another/entries');
  });

  it('keeps person-level paths out of any club', () => {
    expect(paths.userPrivate('u1')).toBe('userPrivate/u1');
    expect(paths.user('u1')).toBe('users/u1');
    expect(paths.club('orewa')).toBe('clubs/orewa');
    expect(paths.notification('n1')).toBe('notifications/n1');
  });
});

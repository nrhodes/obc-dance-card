import { describe, expect, it } from 'vitest';
import { isWideRoute } from './wideRoute';

describe('isWideRoute', () => {
  it('widens the table screens: admin and the members directory', () => {
    for (const path of ['/members', '/admin', '/admin/members', '/admin/programme', '/admin/audit']) {
      expect(isWideRoute(path)).toBe(true);
    }
  });

  it('keeps the phone-first reading width everywhere else', () => {
    for (const path of ['/', '/profile', '/programme', '/calendar', '/session/2027/abc', '/invites', '/membersx', '/administrator']) {
      expect(isWideRoute(path)).toBe(false);
    }
  });
});

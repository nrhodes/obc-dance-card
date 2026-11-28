import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CLUB_ID } from '@obc/shared';
import { chooseClub, readStoredClub, storeClub } from './clubChoice';

describe('chooseClub', () => {
  it('uses the default club when the person has none, or only that one', () => {
    expect(chooseClub([], null)).toBe(DEFAULT_CLUB_ID);
    expect(chooseClub([DEFAULT_CLUB_ID], null)).toBe(DEFAULT_CLUB_ID);
  });

  it("shows a member of only another club that club, not the default", () => {
    expect(chooseClub(['testclub'], null)).toBe('testclub');
  });

  it('prefers the default club for a multi-club member with no remembered choice', () => {
    expect(chooseClub(['testclub', DEFAULT_CLUB_ID], null)).toBe(DEFAULT_CLUB_ID);
  });

  it('honours a remembered choice only while the person still belongs to it', () => {
    expect(chooseClub([DEFAULT_CLUB_ID, 'testclub'], 'testclub')).toBe('testclub');
    expect(chooseClub([DEFAULT_CLUB_ID], 'testclub')).toBe(DEFAULT_CLUB_ID);
  });
});

describe('stored club', () => {
  beforeEach(() => window.localStorage.clear());

  it('is remembered per person', () => {
    expect(readStoredClub('u1')).toBeNull();
    storeClub('u1', 'testclub');
    expect(readStoredClub('u1')).toBe('testclub');
    expect(readStoredClub('u2')).toBeNull();
  });
});

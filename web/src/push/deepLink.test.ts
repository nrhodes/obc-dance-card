import { describe, expect, it } from 'vitest';
import { resolveDeepLink } from './deepLink';

describe('resolveDeepLink', () => {
  it('routes a session notification to the session page', () => {
    expect(resolveDeepLink({ sessionId: 'abc-2027-01-05', year: '2027' })).toBe(
      '/session/2027/abc-2027-01-05',
    );
  });

  it('prefers the session route over an invite id when both are present', () => {
    expect(resolveDeepLink({ sessionId: 'abc', year: '2027', inviteId: 'inv1' })).toBe('/session/2027/abc');
  });

  it('routes an invite notification to the invites screen', () => {
    expect(resolveDeepLink({ inviteId: 'inv1' })).toBe('/invites');
  });

  it('ignores a sessionId with no year', () => {
    expect(resolveDeepLink({ sessionId: 'abc' })).toBe('/notifications');
  });

  it('ignores a year with no sessionId', () => {
    expect(resolveDeepLink({ year: '2027' })).toBe('/notifications');
  });

  it('falls back to the notifications feed for anything else', () => {
    expect(resolveDeepLink({})).toBe('/notifications');
    expect(resolveDeepLink(undefined)).toBe('/notifications');
    expect(resolveDeepLink(null)).toBe('/notifications');
    expect(resolveDeepLink({ teamId: 'team1' })).toBe('/notifications');
  });
});

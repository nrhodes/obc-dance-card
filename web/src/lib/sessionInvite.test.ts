import { describe, expect, it } from 'vitest';
import type { Invite } from '@obc/shared';
import { findPendingInvite } from './sessionInvite';

const inv = (over: Partial<Invite>): Invite => ({
  id: 'i1', scope: 'session', year: 2026, sessionIds: ['s1'], seriesId: null, teamId: null,
  fromMemberId: 'a', toMemberId: 'b', status: 'pending', createdBy: 'a',
  expiresAt: '2099-01-01T00:00:00.000Z', createdAt: 'now', updatedAt: 'now', ...over,
});

describe('findPendingInvite', () => {
  it('finds a pending invite covering the session', () => {
    expect(findPendingInvite([inv({})], 's1')?.id).toBe('i1');
  });
  it('matches a series invite that includes the session among many', () => {
    expect(findPendingInvite([inv({ scope: 'series', sessionIds: ['s0', 's1', 's2'] })], 's1')?.id).toBe('i1');
  });
  it('ignores other sessions and non-pending invites', () => {
    expect(findPendingInvite([inv({ sessionIds: ['sX'] })], 's1')).toBeNull();
    expect(findPendingInvite([inv({ status: 'accepted' })], 's1')).toBeNull();
  });
  it('returns null for an empty list', () => {
    expect(findPendingInvite([], 's1')).toBeNull();
  });
});

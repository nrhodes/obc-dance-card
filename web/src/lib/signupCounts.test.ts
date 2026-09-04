import { describe, expect, it } from 'vitest';
import type { Entry } from '@obc/shared';
import { formatSignupSummary, seriesSignupRange, sessionSignupCounts } from './signupCounts';

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'e1',
    sessionId: 's1',
    date: '2027-01-11',
    weekday: 'monday',
    seriesId: 'monday-pairs',
    memberId: 'member-a',
    status: 'confirmed',
    partner: null,
    pairingId: null,
    teamId: null,
    teamSessionOnly: false,
    substitute: null,
    partnerSubstitute: null,
    isSubstituteFor: null,
    createdBy: 'member-a',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('sessionSignupCounts', () => {
  it('counts a member-member pairing once via shared pairingId', () => {
    const entries = [
      entry({ id: 'e1', memberId: 'm1', pairingId: 'p1', partner: { kind: 'member', memberId: 'm2' } as never }),
      entry({ id: 'e2', memberId: 'm2', pairingId: 'p1', partner: { kind: 'member', memberId: 'm1' } as never }),
    ];
    const counts = sessionSignupCounts('s1', entries);
    expect(counts.pairs).toBe(1);
    expect(counts.total).toBe(2);
  });

  it('counts a member-visitor pairing once (one-sided pairingId)', () => {
    const entries = [entry({ id: 'e1', memberId: 'm1', pairingId: 'p-visitor', partner: { kind: 'visitor', visitorId: 'v1' } as never })];
    const counts = sessionSignupCounts('s1', entries);
    expect(counts.pairs).toBe(1);
    expect(counts.total).toBe(1);
  });

  it('does not double-count a substituted entry: covered + substitute share pairingId', () => {
    // Covered member's own entry stays `substituted` with the same pairingId;
    // the substitute's own entry (if a member) also carries that pairingId.
    const entries = [
      entry({ id: 'covered', memberId: 'm1', pairingId: 'p1', status: 'substituted', substitute: { kind: 'member', memberId: 'm3' } as never }),
      entry({ id: 'remaining', memberId: 'm2', pairingId: 'p1', partnerSubstitute: { kind: 'member', memberId: 'm3' } as never }),
      entry({ id: 'sub-own', memberId: 'm3', pairingId: 'p1', isSubstituteFor: 'm1' }),
    ];
    const counts = sessionSignupCounts('s1', entries);
    expect(counts.pairs).toBe(1);
    expect(counts.total).toBe(3);
  });

  it('counts distinct teamIds once, including teamSessionOnly substitutes', () => {
    const entries = [
      entry({ id: 'e1', memberId: 'm1', teamId: 't1' }),
      entry({ id: 'e2', memberId: 'm2', teamId: 't1' }),
      entry({ id: 'e3', memberId: 'm4', teamId: 't1', teamSessionOnly: true }),
      entry({ id: 'e4', memberId: 'm3', teamId: 't2' }),
    ];
    const counts = sessionSignupCounts('s1', entries);
    expect(counts.teams).toBe(2);
    expect(counts.total).toBe(4);
  });

  it('counts looking/available/unavailable by status', () => {
    const entries = [
      entry({ id: 'e1', memberId: 'm1', status: 'looking_for_partner' }),
      entry({ id: 'e2', memberId: 'm2', status: 'looking_for_partner' }),
      entry({ id: 'e3', memberId: 'm3', status: 'available' }),
      entry({ id: 'e4', memberId: 'm4', status: 'unavailable' }),
    ];
    const counts = sessionSignupCounts('s1', entries);
    expect(counts.looking).toBe(2);
    expect(counts.available).toBe(1);
    expect(counts.unavailable).toBe(1);
    expect(counts.total).toBe(4);
  });

  it('excludes cancelled entries entirely', () => {
    const entries = [
      entry({ id: 'e1', memberId: 'm1', pairingId: 'p1', status: 'cancelled' }),
      entry({ id: 'e2', memberId: 'm2', status: 'cancelled' }),
    ];
    const counts = sessionSignupCounts('s1', entries);
    expect(counts).toEqual({ pairs: 0, teams: 0, looking: 0, available: 0, unavailable: 0, total: 0 });
  });

  it('ignores entries for other sessions', () => {
    const entries = [entry({ id: 'e1', sessionId: 'other-session', pairingId: 'p1' })];
    const counts = sessionSignupCounts('s1', entries);
    expect(counts.total).toBe(0);
  });

  it('returns all-zero counts for a session with no entries', () => {
    expect(sessionSignupCounts('s1', [])).toEqual({ pairs: 0, teams: 0, looking: 0, available: 0, unavailable: 0, total: 0 });
  });
});

describe('formatSignupSummary', () => {
  it('leads with pairs for non-Teams formats and appends non-zero statuses', () => {
    const counts = sessionSignupCounts('s1', [
      entry({ id: 'e1', memberId: 'm1', pairingId: 'p1' }),
      entry({ id: 'e2', memberId: 'm2', pairingId: 'p1' }),
      entry({ id: 'e3', memberId: 'm3', pairingId: 'p2' }),
      entry({ id: 'e4', memberId: 'm4', pairingId: 'p3' }),
      entry({ id: 'e5', memberId: 'm5', status: 'looking_for_partner' }),
      entry({ id: 'e6', memberId: 'm6', status: 'looking_for_partner' }),
    ]);
    expect(formatSignupSummary(counts, 'Pairs')).toBe('3 pairs · 2 looking');
  });

  it('leads with teams for Teams format', () => {
    const counts = sessionSignupCounts('s1', [
      entry({ id: 'e1', memberId: 'm1', teamId: 't1' }),
      entry({ id: 'e2', memberId: 'm2', teamId: 't2' }),
      entry({ id: 'e3', memberId: 'm3', status: 'available' }),
    ]);
    expect(formatSignupSummary(counts, 'Teams')).toBe('2 teams · 1 available');
  });

  it('singularises a single pair/team', () => {
    const counts = sessionSignupCounts('s1', [entry({ id: 'e1', memberId: 'm1', pairingId: 'p1' })]);
    expect(formatSignupSummary(counts, 'Pairs')).toBe('1 pair');
  });

  it('omits a zero lead and just lists solo statuses', () => {
    const counts = sessionSignupCounts('s1', [entry({ id: 'e1', memberId: 'm1', status: 'unavailable' })]);
    expect(formatSignupSummary(counts, 'Pairs')).toBe('1 unavailable');
  });

  it('returns "No sign-ups yet" when everything is zero', () => {
    const counts = sessionSignupCounts('s1', []);
    expect(formatSignupSummary(counts, 'Pairs')).toBe('No sign-ups yet');
  });

  it('an Individual-format session leads with pairs like the default', () => {
    const counts = sessionSignupCounts('s1', [entry({ id: 'e1', memberId: 'm1', pairingId: 'p1' })]);
    expect(formatSignupSummary(counts, 'Individual')).toBe('1 pair');
  });
});

describe('seriesSignupRange', () => {
  it('returns null for a series with no sessions', () => {
    expect(seriesSignupRange([], new Map(), 'Pairs')).toBeNull();
  });

  it('collapses to a single value when every session has the same count', () => {
    const countsBySessionId = new Map([
      ['s1', sessionSignupCounts('s1', [entry({ id: 'e1', sessionId: 's1', pairingId: 'p1' })])],
      ['s2', sessionSignupCounts('s2', [entry({ id: 'e2', sessionId: 's2', pairingId: 'p2' })])],
    ]);
    expect(seriesSignupRange(['s1', 's2'], countsBySessionId, 'Pairs')).toBe('1 pair every session');
  });

  it('renders a range across sessions with varying counts', () => {
    const countsBySessionId = new Map([
      [
        's1',
        sessionSignupCounts('s1', [
          entry({ id: 'e1', sessionId: 's1', pairingId: 'p1' }),
          entry({ id: 'e2', sessionId: 's1', pairingId: 'p2' }),
        ]),
      ],
      [
        's2',
        sessionSignupCounts('s2', [
          entry({ id: 'e3', sessionId: 's2', pairingId: 'p3' }),
          entry({ id: 'e4', sessionId: 's2', pairingId: 'p4' }),
          entry({ id: 'e5', sessionId: 's2', pairingId: 'p5' }),
          entry({ id: 'e6', sessionId: 's2', pairingId: 'p6' }),
          entry({ id: 'e7', sessionId: 's2', pairingId: 'p7' }),
        ]),
      ],
      ['s3', sessionSignupCounts('s3', [])],
      ['s4', sessionSignupCounts('s4', [])],
    ]);
    expect(seriesSignupRange(['s1', 's2', 's3', 's4'], countsBySessionId, 'Pairs')).toBe('pairs 0–5 across 4 sessions');
  });

  it('rolls up teams instead of pairs for Teams format', () => {
    const countsBySessionId = new Map([
      ['s1', sessionSignupCounts('s1', [entry({ id: 'e1', sessionId: 's1', teamId: 't1' })])],
      [
        's2',
        sessionSignupCounts('s2', [
          entry({ id: 'e2', sessionId: 's2', teamId: 't1' }),
          entry({ id: 'e3', sessionId: 's2', teamId: 't2' }),
        ]),
      ],
    ]);
    expect(seriesSignupRange(['s1', 's2'], countsBySessionId, 'Teams')).toBe('teams 1–2 across 2 sessions');
  });

  it('treats a session missing from the counts map as zero', () => {
    const countsBySessionId = new Map([
      ['s1', sessionSignupCounts('s1', [entry({ id: 'e1', sessionId: 's1', pairingId: 'p1' })])],
    ]);
    expect(seriesSignupRange(['s1', 's-missing'], countsBySessionId, 'Pairs')).toBe('pair 0–1 across 2 sessions');
  });
});

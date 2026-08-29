import { describe, expect, it } from 'vitest';
import type { Entry, Series, Team } from '@obc/shared';
import { buildTeamSessionView, isTeamFull, teamStatusLabel } from './team';

function series(overrides: Partial<Series> = {}): Series {
  return {
    id: 'monday-campbell-cave-teams',
    weekday: 'monday',
    name: 'Campbell Cave Teams',
    scoring: 'Scr',
    format: 'Teams',
    bestOf: null,
    allowSubstitute: true,
    order: 0,
    sessionIds: [],
    teamMin: 4,
    teamMax: 6,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function team(overrides: Partial<Team> = {}): Team {
  return {
    id: 'monday-campbell-cave-teams-member-a',
    year: 2027,
    seriesId: 'monday-campbell-cave-teams',
    name: 'Doe team',
    captainMemberId: 'member-a',
    members: [
      { ref: { kind: 'member', memberId: 'member-a', displayName: 'Jane Doe' }, joinedAt: '' },
      { ref: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' }, joinedAt: '' },
    ],
    status: 'forming',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function entry(overrides: Partial<Entry>): Entry {
  return {
    id: 'e1',
    sessionId: 's1',
    date: '2027-09-20',
    weekday: 'monday',
    seriesId: 'monday-campbell-cave-teams',
    memberId: 'member-a',
    status: 'confirmed',
    partner: null,
    pairingId: null,
    teamId: 'monday-campbell-cave-teams-member-a',
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

describe('teamStatusLabel', () => {
  it('reads "Forming (N of min–max)" below teamMin', () => {
    expect(teamStatusLabel(team({ status: 'forming' }), series())).toBe('Forming (2 of 4–6)');
  });

  it('reads "Active (N of min–max)" at/above teamMin', () => {
    const t = team({
      status: 'active',
      members: Array.from({ length: 4 }, (_, i) => ({ ref: { kind: 'member' as const, memberId: `m${i}`, displayName: `M${i}` }, joinedAt: '' })),
    });
    expect(teamStatusLabel(t, series())).toBe('Active (4 of 4–6)');
  });
});

describe('isTeamFull', () => {
  it('false below teamMax', () => {
    expect(isTeamFull(team(), series({ teamMax: 6 }))).toBe(false);
  });

  it('true at teamMax', () => {
    expect(isTeamFull(team(), series({ teamMax: 2 }))).toBe(true);
  });
});

describe('buildTeamSessionView', () => {
  it('empty when nobody is absent and no substitutes recorded', () => {
    const t = team();
    const entries = [entry({ id: 'e-a', memberId: 'member-a' }), entry({ id: 'e-b', memberId: 'member-b' })];
    const view = buildTeamSessionView(t, entries, 's1');
    expect(view).toEqual({ absentMemberIds: [], memberSubstitutes: [], visitorSubstitutes: [], hasAbsence: false });
  });

  it('lists a rostered member whose entry is cancelled as absent', () => {
    const t = team();
    const entries = [entry({ id: 'e-a', memberId: 'member-a', status: 'cancelled' }), entry({ id: 'e-b', memberId: 'member-b' })];
    const view = buildTeamSessionView(t, entries, 's1');
    expect(view.absentMemberIds).toEqual(['member-a']);
    expect(view.hasAbsence).toBe(true);
  });

  it('lists a teamSessionOnly entry as a member substitute, not an absence', () => {
    const t = team();
    const entries = [
      entry({ id: 'e-a', memberId: 'member-a', status: 'cancelled' }),
      entry({ id: 'e-b', memberId: 'member-b' }),
      entry({ id: 'e-sub', memberId: 'member-z', teamSessionOnly: true, status: 'confirmed' }),
    ];
    const view = buildTeamSessionView(t, entries, 's1');
    expect(view.absentMemberIds).toEqual(['member-a']);
    expect(view.memberSubstitutes.map((e) => e.memberId)).toEqual(['member-z']);
  });

  it('lists a visitor session substitute from team.sessionVisitors', () => {
    const t = team({ sessionVisitors: { s1: [{ kind: 'visitor', visitorId: 'v1', displayName: 'Bob Visitor' }] } });
    const view = buildTeamSessionView(t, [], 's1');
    expect(view.visitorSubstitutes).toEqual([{ kind: 'visitor', visitorId: 'v1', displayName: 'Bob Visitor' }]);
  });

  it('ignores entries for a different session', () => {
    const t = team();
    const entries = [entry({ id: 'e-a', memberId: 'member-a', status: 'cancelled', sessionId: 'other-session' })];
    const view = buildTeamSessionView(t, entries, 's1');
    expect(view.absentMemberIds).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import type { Entry, Series, Session, Team, WeekdayProgramme } from '@obc/shared';
import { buildPastRows, describeCardStatus, groupCardEntries } from './card';

function baseEntry(overrides: Partial<Entry>): Entry {
  return {
    id: 'e1',
    sessionId: 'monday-marion-taylor-pairs-2027-01-11',
    date: '2027-01-11',
    weekday: 'monday',
    seriesId: 'monday-marion-taylor-pairs',
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
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'monday-marion-taylor-pairs-2027-01-11',
    date: '2027-01-11',
    weekday: 'monday',
    seriesId: 'monday-marion-taylor-pairs',
    kind: 'series',
    title: 'Marion Taylor Pairs',
    partnerRequired: true,
    seriesName: 'Marion Taylor Pairs',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function series(overrides: Partial<Series> = {}): Series {
  return {
    id: 'monday-marion-taylor-pairs',
    weekday: 'monday',
    name: 'Marion Taylor Pairs',
    scoring: 'Scr',
    format: 'Pairs',
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

function weekday(overrides: Partial<WeekdayProgramme> = {}): WeekdayProgramme {
  return {
    id: 'monday',
    weekday: 'monday',
    label: 'Monday Afternoon',
    startTime: '13:00',
    seatedByTime: '12:45',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('describeCardStatus', () => {
  it('describes a plain confirmed pairing', () => {
    const entry = baseEntry({ partner: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' } });
    expect(describeCardStatus(entry)).toBe('with John Smith');
  });

  it('marks a visitor partner', () => {
    const entry = baseEntry({ partner: { kind: 'visitor', visitorId: 'v1', displayName: 'Bob Visitor' } });
    expect(describeCardStatus(entry)).toBe('with Bob Visitor (visitor)');
  });

  it('shows "sub: X for partner" when my partner has a substitute this week', () => {
    const entry = baseEntry({
      partner: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' },
      partnerSubstitute: { kind: 'member', memberId: 'member-c', displayName: 'Amy Lee' },
    });
    expect(describeCardStatus(entry)).toBe('with John Smith — sub: Amy Lee for John Smith');
  });

  it('shows "you\'re covered by X" when I am substituted this week', () => {
    const entry = baseEntry({
      status: 'substituted',
      partner: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' },
      substitute: { kind: 'member', memberId: 'member-c', displayName: 'Amy Lee' },
    });
    expect(describeCardStatus(entry)).toBe("with John Smith — you're covered by Amy Lee");
  });

  it('describes looking_for_partner and available', () => {
    expect(describeCardStatus(baseEntry({ status: 'looking_for_partner', partner: null }))).toBe('Looking for a partner');
    expect(describeCardStatus(baseEntry({ status: 'available', partner: null }))).toBe('Available');
  });

  it('shows the team name for a team entry', () => {
    const team: Team = {
      id: 'team-1',
      year: 2027,
      seriesId: 'monday-campbell-cave-teams',
      name: 'Doe team',
      captainMemberId: 'member-a',
      members: [],
      status: 'active',
      createdAt: '',
      updatedAt: '',
    };
    const entry = baseEntry({ teamId: 'team-1', partner: null });
    expect(describeCardStatus(entry, [team])).toBe('Doe team');
  });

  it('falls back gracefully when a team is not yet loaded', () => {
    const entry = baseEntry({ teamId: 'team-unknown', partner: null });
    expect(describeCardStatus(entry, [])).toBe('On a team');
  });
});

describe('groupCardEntries', () => {
  it('groups by weekday then series, sessions in date order, dropping cancelled entries', () => {
    const entries: Entry[] = [
      baseEntry({ id: 'e1', date: '2027-01-18', status: 'looking_for_partner', partner: null }),
      baseEntry({ id: 'e2', date: '2027-01-11', status: 'looking_for_partner', partner: null }),
      baseEntry({ id: 'e3', date: '2027-01-04', status: 'cancelled', partner: null }),
      baseEntry({
        id: 'e4',
        date: '2027-01-13',
        weekday: 'wednesday',
        seriesId: null,
        sessionId: 'wednesday-2027-01-13',
        status: 'available',
        partner: null,
      }),
    ];
    const sessions: Session[] = [session(), session({ id: 'wednesday-2027-01-13', date: '2027-01-13', weekday: 'wednesday', seriesId: null, kind: 'holidayBridge', title: 'Holiday Bridge' })];
    const groups = groupCardEntries(entries, sessions, [series()], [weekday()]);

    expect(groups.map((g) => g.weekday)).toEqual(['monday', 'wednesday']);
    const monday = groups[0]!;
    expect(monday.label).toBe('Monday Afternoon');
    expect(monday.groups).toHaveLength(1);
    expect(monday.groups[0]!.title).toBe('Marion Taylor Pairs');
    expect(monday.groups[0]!.rows.map((r) => r.date)).toEqual(['2027-01-11', '2027-01-18']);

    const wednesday = groups[1]!;
    expect(wednesday.groups[0]!.title).toBe('Holiday Bridge');
  });

  it('returns nothing for an all-cancelled set', () => {
    const entries: Entry[] = [baseEntry({ status: 'cancelled', partner: null })];
    expect(groupCardEntries(entries, [session()], [series()], [weekday()])).toEqual([]);
  });
});

describe('buildPastRows', () => {
  it('sorts most-recent first and drops cancelled entries', () => {
    const entries: Entry[] = [
      baseEntry({ id: 'e1', date: '2027-01-04', status: 'available', partner: null }),
      baseEntry({ id: 'e2', date: '2027-01-11', status: 'looking_for_partner', partner: null }),
      baseEntry({ id: 'e3', date: '2027-01-18', status: 'cancelled', partner: null }),
    ];
    const rows = buildPastRows(entries, [session()], [series()]);
    expect(rows.map((r) => r.date)).toEqual(['2027-01-11', '2027-01-04']);
  });
});

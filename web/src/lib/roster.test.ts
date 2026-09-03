import { describe, expect, it } from 'vitest';
import type { Entry, Team } from '@obc/shared';
import { buildPairsRoster, buildSessionRoster, buildSoloRows, describeOwnEntry, noticeboardLabels } from './roster';

function baseEntry(overrides: Partial<Entry>): Entry {
  return {
    id: 'e1',
    sessionId: 's1',
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

const nameOf = (id: string) => ({ 'member-a': 'Jane Doe', 'member-b': 'John Smith', 'member-c': 'Amy Lee' })[id] ?? id;

describe('buildPairsRoster', () => {
  it('dedupes a member-member pairing into one row', () => {
    const entries: Entry[] = [
      baseEntry({
        id: 'e-a',
        memberId: 'member-a',
        pairingId: 'p1',
        partner: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' },
      }),
      baseEntry({
        id: 'e-b',
        memberId: 'member-b',
        pairingId: 'p1',
        partner: { kind: 'member', memberId: 'member-a', displayName: 'Jane Doe' },
      }),
    ];
    const rows = buildPairsRoster(entries, nameOf);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.aName).toBe('Jane Doe');
    expect(rows[0]!.bName).toBe('John Smith');
    expect(rows[0]!.isVisitor).toBe(false);
  });

  it('renders a visitor pairing with the (visitor) marker available to the caller', () => {
    const entries: Entry[] = [
      baseEntry({
        id: 'e-a',
        memberId: 'member-a',
        pairingId: 'p-visitor',
        partner: { kind: 'visitor', visitorId: 'v1', displayName: 'Bob Visitor' },
      }),
    ];
    const rows = buildPairsRoster(entries, nameOf);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.isVisitor).toBe(true);
    expect(rows[0]!.bName).toBe('Bob Visitor');
    expect(rows[0]!.bMemberId).toBeNull();
  });

  it('shows a substitution as "(sub: X for B)" shape', () => {
    const entries: Entry[] = [
      baseEntry({
        id: 'e-a',
        memberId: 'member-a',
        pairingId: 'p1',
        status: 'confirmed',
        partner: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' },
        partnerSubstitute: { kind: 'member', memberId: 'member-c', displayName: 'Amy Lee' },
      }),
      baseEntry({
        id: 'e-b',
        memberId: 'member-b',
        pairingId: 'p1',
        status: 'substituted',
        partner: { kind: 'member', memberId: 'member-a', displayName: 'Jane Doe' },
        substitute: { kind: 'member', memberId: 'member-c', displayName: 'Amy Lee' },
      }),
      baseEntry({
        id: 'e-c',
        memberId: 'member-c',
        pairingId: 'p1',
        status: 'confirmed',
        partner: { kind: 'member', memberId: 'member-a', displayName: 'Jane Doe' },
        isSubstituteFor: 'member-b',
      }),
    ];
    const rows = buildPairsRoster(entries, nameOf);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.aName).toBe('Jane Doe');
    expect(row.bName).toBe('John Smith');
    expect(row.substitute).toEqual({ name: 'Amy Lee', coveredName: 'John Smith' });
  });

  it('excludes cancelled and team entries', () => {
    const entries: Entry[] = [
      baseEntry({ id: 'e-cancelled', memberId: 'member-a', status: 'cancelled', pairingId: 'p1' }),
      baseEntry({ id: 'e-team', memberId: 'member-b', status: 'confirmed', teamId: 'team-1', partner: null }),
    ];
    expect(buildPairsRoster(entries, nameOf)).toEqual([]);
  });
});

describe('buildSoloRows', () => {
  it('lists looking_for_partner entries only, excluding team/available', () => {
    const entries: Entry[] = [
      baseEntry({ id: 'e-lfp', memberId: 'member-a', status: 'looking_for_partner' }),
      baseEntry({ id: 'e-avail', memberId: 'member-b', status: 'available' }),
      baseEntry({ id: 'e-team-lfp', memberId: 'member-c', status: 'looking_for_partner', teamId: 'team-1' }),
    ];
    const rows = buildSoloRows(entries, 'looking_for_partner', nameOf);
    expect(rows.map((r) => r.name)).toEqual(['Jane Doe']);
  });
});

describe('buildSessionRoster', () => {
  it('never lists an unavailable entry on either noticeboard list (plan §21 B2)', () => {
    const entries: Entry[] = [
      baseEntry({ id: 'e-unavailable', memberId: 'member-a', status: 'unavailable' }),
      baseEntry({ id: 'e-lfp', memberId: 'member-b', status: 'looking_for_partner' }),
    ];
    const roster = buildSessionRoster(entries, nameOf);
    expect(roster.lookingForPartner.map((r) => r.memberId)).toEqual(['member-b']);
    expect(roster.available).toEqual([]);
  });
});

describe('noticeboardLabels', () => {
  it('reads "Looking for a partner" / "Available" for non-Teams formats', () => {
    expect(noticeboardLabels('Pairs')).toEqual({ lfp: 'Looking for a partner', available: 'Available' });
    expect(noticeboardLabels(undefined)).toEqual({ lfp: 'Looking for a partner', available: 'Available' });
  });

  it('reads "Looking for a team" / "Available for a team" for Teams', () => {
    expect(noticeboardLabels('Teams')).toEqual({ lfp: 'Looking for a team', available: 'Available for a team' });
  });
});

describe('describeOwnEntry', () => {
  it('describes a confirmed pairing', () => {
    const entry = baseEntry({ status: 'confirmed', partner: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' } });
    expect(describeOwnEntry(entry, [])).toBe('You: confirmed with John Smith');
  });

  it('describes a visitor pairing', () => {
    const entry = baseEntry({ status: 'confirmed', partner: { kind: 'visitor', visitorId: 'v1', displayName: 'Bob Visitor' } });
    expect(describeOwnEntry(entry, [])).toBe('You: confirmed with Bob Visitor (visitor)');
  });

  it('describes looking_for_partner and available', () => {
    expect(describeOwnEntry(baseEntry({ status: 'looking_for_partner' }), [])).toBe("You're looking for a partner.");
    expect(describeOwnEntry(baseEntry({ status: 'available' }), [])).toBe("You're marked as available.");
  });

  it('describes unavailable (plan §21 B2)', () => {
    expect(describeOwnEntry(baseEntry({ status: 'unavailable' }), [])).toBe("You've marked yourself unavailable for this session.");
  });

  it('describes a team member entry using the team name', () => {
    const team: Team = {
      id: 'team-1',
      year: 2027,
      seriesId: 'monday-campbell-cave-teams',
      name: 'Doe team',
      captainMemberId: 'member-a',
      members: [],
      status: 'active',
      createdAt: '2027-01-01T00:00:00.000Z',
      updatedAt: '2027-01-01T00:00:00.000Z',
    };
    const entry = baseEntry({ status: 'confirmed', teamId: 'team-1', partner: null });
    expect(describeOwnEntry(entry, [team])).toBe('You: on team "Doe team"');
  });

  it('returns null for a cancelled entry', () => {
    expect(describeOwnEntry(baseEntry({ status: 'cancelled' }), [])).toBeNull();
  });
});

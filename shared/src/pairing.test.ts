import { describe, expect, it } from 'vitest';
import { validatePairingGroup, validateTeamGroup } from './pairing.js';
import type { Entry, PartnerRef, Series, Team } from './models.js';

const TS = { createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:00.000Z' };

function entry(over: Partial<Entry> & Pick<Entry, 'id' | 'memberId'>): Entry {
  return {
    sessionId: 's1',
    date: '2027-01-12',
    weekday: 'monday',
    seriesId: 'ser1',
    status: 'confirmed',
    partner: null,
    pairingId: null,
    teamId: null,
    teamSessionOnly: false,
    substitute: null,
    partnerSubstitute: null,
    isSubstituteFor: null,
    createdBy: over.memberId,
    ...TS,
    ...over,
  };
}

const memberRef = (memberId: string, displayName = memberId): PartnerRef => ({
  kind: 'member',
  memberId,
  displayName,
});
const visitorRef = (visitorId: string, displayName = visitorId): PartnerRef => ({
  kind: 'visitor',
  visitorId,
  displayName,
});

describe('validatePairingGroup', () => {
  it('accepts a valid member/member pair', () => {
    const a = entry({ id: 'e-a', memberId: 'alice', partner: memberRef('bob'), pairingId: 'p1' });
    const b = entry({ id: 'e-b', memberId: 'bob', partner: memberRef('alice'), pairingId: 'p1' });
    expect(validatePairingGroup([a, b])).toEqual([]);
  });

  it('accepts a valid visitor pairing', () => {
    const a = entry({
      id: 'e-a',
      memberId: 'alice',
      partner: visitorRef('vis1', 'Jane Visitor'),
      pairingId: 'p1',
    });
    expect(validatePairingGroup([a])).toEqual([]);
  });

  it('rejects a one-sided member pairing (missing mirror)', () => {
    const a = entry({ id: 'e-a', memberId: 'alice', partner: memberRef('bob'), pairingId: 'p1' });
    expect(validatePairingGroup([a])).not.toEqual([]);
  });

  it('rejects a mismatched pairingId', () => {
    const a = entry({ id: 'e-a', memberId: 'alice', partner: memberRef('bob'), pairingId: 'p1' });
    const b = entry({ id: 'e-b', memberId: 'bob', partner: memberRef('alice'), pairingId: 'p2' });
    expect(validatePairingGroup([a, b])).not.toEqual([]);
  });

  it('accepts a valid substitution shape with a member substitute', () => {
    // Alice/Bob are paired; Xavier covers Bob for this session.
    const a = entry({
      id: 'e-a',
      memberId: 'alice',
      partner: memberRef('bob'),
      pairingId: 'p1',
      partnerSubstitute: memberRef('xavier'),
    });
    const b = entry({
      id: 'e-b',
      memberId: 'bob',
      status: 'substituted',
      partner: memberRef('alice'),
      pairingId: 'p1',
      substitute: memberRef('xavier'),
    });
    const x = entry({
      id: 'e-x',
      memberId: 'xavier',
      partner: memberRef('alice'),
      pairingId: 'p1',
      isSubstituteFor: 'bob',
    });
    expect(validatePairingGroup([a, b, x])).toEqual([]);
  });

  it('accepts a valid substitution shape with a visitor substitute', () => {
    const a = entry({
      id: 'e-a',
      memberId: 'alice',
      partner: memberRef('bob'),
      pairingId: 'p1',
      partnerSubstitute: visitorRef('vis1'),
    });
    const b = entry({
      id: 'e-b',
      memberId: 'bob',
      status: 'substituted',
      partner: memberRef('alice'),
      pairingId: 'p1',
      substitute: visitorRef('vis1'),
    });
    expect(validatePairingGroup([a, b])).toEqual([]);
  });

  it('rejects orphan substitution fields on a fully-confirmed pairing', () => {
    const a = entry({
      id: 'e-a',
      memberId: 'alice',
      partner: memberRef('bob'),
      pairingId: 'p1',
      substitute: memberRef('xavier'),
    });
    const b = entry({ id: 'e-b', memberId: 'bob', partner: memberRef('alice'), pairingId: 'p1' });
    expect(validatePairingGroup([a, b])).not.toEqual([]);
  });

  it('rejects a solo status with a partner set', () => {
    const a = entry({
      id: 'e-a',
      memberId: 'alice',
      status: 'looking_for_partner',
      partner: memberRef('bob'),
    });
    expect(validatePairingGroup([a])).not.toEqual([]);
  });

  it('rejects a duplicate member appearing twice in the group', () => {
    const a = entry({ id: 'e-a', memberId: 'alice', status: 'looking_for_partner' });
    const a2 = entry({ id: 'e-a2', memberId: 'alice', status: 'available' });
    expect(validatePairingGroup([a, a2])).not.toEqual([]);
  });
});

describe('validateTeamGroup', () => {
  const series: Series = {
    id: 'ser1',
    weekday: 'monday',
    name: 'Campbell Cave Teams',
    scoring: 'Scr',
    format: 'Teams',
    bestOf: null,
    allowSubstitute: true,
    order: 1,
    sessionIds: ['s1', 's2'],
    teamMin: 4,
    teamMax: 6,
    ...TS,
  };

  function team(over: Partial<Team> = {}): Team {
    return {
      id: 'team1',
      year: 2027,
      seriesId: 'ser1',
      name: 'Alice team',
      captainMemberId: 'alice',
      status: 'active',
      members: [
        { ref: memberRef('alice'), joinedAt: TS.createdAt },
        { ref: memberRef('bob'), joinedAt: TS.createdAt },
        { ref: memberRef('carol'), joinedAt: TS.createdAt },
        { ref: memberRef('dave'), joinedAt: TS.createdAt },
      ],
      ...TS,
      ...over,
    };
  }

  function rosterEntries(sessionId: string, memberIds: string[]): Entry[] {
    return memberIds.map((memberId) =>
      entry({ id: `${sessionId}_${memberId}`, memberId, sessionId, teamId: 'team1', partner: null }),
    );
  }

  it('accepts a valid, fully-rostered team', () => {
    const t = team();
    const entries = [
      ...rosterEntries('s1', ['alice', 'bob', 'carol', 'dave']),
      ...rosterEntries('s2', ['alice', 'bob', 'carol', 'dave']),
    ];
    expect(validateTeamGroup(t, series, entries)).toEqual([]);
  });

  it('flags a missing entry for a rostered member', () => {
    const t = team();
    const entries = [
      ...rosterEntries('s1', ['alice', 'bob', 'carol']), // dave missing
      ...rosterEntries('s2', ['alice', 'bob', 'carol', 'dave']),
    ];
    expect(validateTeamGroup(t, series, entries)).not.toEqual([]);
  });

  it('flags an entry for someone not on the roster', () => {
    const t = team();
    const entries = [
      ...rosterEntries('s1', ['alice', 'bob', 'carol', 'dave', 'eve']),
      ...rosterEntries('s2', ['alice', 'bob', 'carol', 'dave']),
    ];
    expect(validateTeamGroup(t, series, entries)).not.toEqual([]);
  });

  it('flags a team entry with a partner set', () => {
    const t = team();
    const entries = [
      ...rosterEntries('s1', ['alice', 'bob', 'carol']).map((e) =>
        e.memberId === 'carol' ? { ...e, partner: memberRef('dave') } : e,
      ),
      ...rosterEntries('s1', ['dave']),
      ...rosterEntries('s2', ['alice', 'bob', 'carol', 'dave']),
    ];
    expect(validateTeamGroup(t, series, entries)).not.toEqual([]);
  });

  it('flags a team over teamMax', () => {
    const t = team({
      members: [
        { ref: memberRef('alice'), joinedAt: TS.createdAt },
        { ref: memberRef('bob'), joinedAt: TS.createdAt },
        { ref: memberRef('carol'), joinedAt: TS.createdAt },
        { ref: memberRef('dave'), joinedAt: TS.createdAt },
        { ref: memberRef('eve'), joinedAt: TS.createdAt },
        { ref: memberRef('frank'), joinedAt: TS.createdAt },
        { ref: memberRef('gina'), joinedAt: TS.createdAt },
      ],
    });
    expect(validateTeamGroup(t, series, [])).not.toEqual([]);
  });

  it('flags a captain who is not in team.members', () => {
    const t = team({ captainMemberId: 'zoe' });
    const entries = [
      ...rosterEntries('s1', ['alice', 'bob', 'carol', 'dave']),
      ...rosterEntries('s2', ['alice', 'bob', 'carol', 'dave']),
    ];
    expect(validateTeamGroup(t, series, entries)).not.toEqual([]);
  });

  it('flags a teamSessionOnly entry with no cancelled roster member for that session', () => {
    const t = team();
    const entries = [
      ...rosterEntries('s1', ['alice', 'bob', 'carol', 'dave']),
      ...rosterEntries('s2', ['alice', 'bob', 'carol', 'dave']),
      entry({
        id: 's1_subX',
        memberId: 'subX',
        sessionId: 's1',
        teamId: 'team1',
        teamSessionOnly: true,
      }),
    ];
    expect(validateTeamGroup(t, series, entries)).not.toEqual([]);
  });

  it('accepts a teamSessionOnly substitute covering a cancelled roster member', () => {
    const t = team();
    const s1Roster = rosterEntries('s1', ['alice', 'bob', 'carol', 'dave']).map((e) =>
      e.memberId === 'dave' ? { ...e, status: 'cancelled' as const } : e,
    );
    const entries = [
      ...s1Roster,
      ...rosterEntries('s2', ['alice', 'bob', 'carol', 'dave']),
      entry({
        id: 's1_subX',
        memberId: 'subX',
        sessionId: 's1',
        teamId: 'team1',
        teamSessionOnly: true,
      }),
    ];
    expect(validateTeamGroup(t, series, entries)).toEqual([]);
  });
});

describe('validatePairingGroup — orchestrator review additions', () => {
  it('does not flag the same member across different sessions (sweep input)', () => {
    const a1 = entry({ id: 's1_alice', memberId: 'alice', sessionId: 's1', partner: memberRef('bob'), pairingId: 'p1' });
    const b1 = entry({ id: 's1_bob', memberId: 'bob', sessionId: 's1', partner: memberRef('alice'), pairingId: 'p1' });
    const a2 = entry({ id: 's2_alice', memberId: 'alice', sessionId: 's2', partner: memberRef('bob'), pairingId: 'p2' });
    const b2 = entry({ id: 's2_bob', memberId: 'bob', sessionId: 's2', partner: memberRef('alice'), pairingId: 'p2' });
    expect(validatePairingGroup([a1, b1, a2, b2])).toEqual([]);
  });

  it('rejects a pairing whose two halves are in different sessions', () => {
    const a = entry({ id: 's1_alice', memberId: 'alice', sessionId: 's1', partner: memberRef('bob'), pairingId: 'p1' });
    const b = entry({ id: 's2_bob', memberId: 'bob', sessionId: 's2', partner: memberRef('alice'), pairingId: 'p1' });
    expect(validatePairingGroup([a, b]).join(' ')).toMatch(/more than one session/);
  });

  it('rejects a visitor pairing that is not confirmed or carries substitution fields', () => {
    const lfp = entry({ id: 'e-a', memberId: 'alice', status: 'substituted', partner: visitorRef('v1'), pairingId: 'p1' });
    expect(validatePairingGroup([lfp]).join(' ')).toMatch(/visitor pairing entry must be 'confirmed'/);
    const withSub = entry({ id: 'e-b', memberId: 'bob', partner: visitorRef('v1'), pairingId: 'p2', partnerSubstitute: memberRef('x') });
    expect(validatePairingGroup([withSub]).join(' ')).toMatch(/substitution fields/);
  });
});

describe('validateTeamGroup — orchestrator review additions', () => {
  const series: Series = {
    id: 'ser-t', weekday: 'monday', name: 'Teams', scoring: 'Scr', format: 'Teams', bestOf: null,
    allowSubstitute: true, order: 1, sessionIds: ['s1'], teamMin: 4, teamMax: 6, ...TS,
  };
  const team = (members: string[], captain = members[0]!): Team => ({
    id: 'ser-t-' + captain, year: 2027, seriesId: 'ser-t', name: 't', captainMemberId: captain,
    members: members.map((m) => ({ ref: memberRef(m), joinedAt: TS.createdAt })), status: 'active', ...TS,
  });
  const teamEntry = (memberId: string, over: Partial<Entry> = {}) =>
    entry({ id: `s1_${memberId}`, memberId, sessionId: 's1', seriesId: 'ser-t', teamId: 'ser-t-cap', ...over });

  it('flags a duplicate reference in team.members', () => {
    const t = team(['cap', 'b', 'c', 'b']);
    const entries = ['cap', 'b', 'c'].map((m) => teamEntry(m));
    expect(validateTeamGroup(t, series, entries).join(' ')).toMatch(/duplicate reference/);
  });

  it('flags a roster entry that is not confirmed', () => {
    const t = team(['cap', 'b', 'c', 'd']);
    const entries = [teamEntry('cap'), teamEntry('b', { status: 'looking_for_partner' }), teamEntry('c'), teamEntry('d')];
    expect(validateTeamGroup(t, series, entries).join(' ')).toMatch(/must be 'confirmed'/);
  });

  it('flags a teamSessionOnly entry for a member who is already on the roster', () => {
    const t = team(['cap', 'b', 'c', 'd']);
    const entries = [
      teamEntry('cap'), teamEntry('b', { status: 'cancelled' }), teamEntry('c'), teamEntry('d'),
      teamEntry('c', { id: 's1_c_sub', teamSessionOnly: true }),
    ];
    expect(validateTeamGroup(t, series, entries).join(' ')).toMatch(/belongs to a rostered member/);
  });
});

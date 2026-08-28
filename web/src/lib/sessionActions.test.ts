import { describe, expect, it } from 'vitest';
import type { Entry, Session, WeekdayProgramme } from '@obc/shared';
import { describeCancelConsequence, deriveSessionActions } from './sessionActions';
import type { SessionRosterView } from './roster';

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

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'monday-marion-taylor-pairs-2027-01-11',
    date: '2027-01-11',
    weekday: 'monday',
    seriesId: 'monday-marion-taylor-pairs',
    kind: 'series',
    title: 'Marion Taylor Pairs',
    partnerRequired: true,
    format: 'Pairs',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function entry(overrides: Partial<Entry>): Entry {
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
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

const emptyRoster: SessionRosterView = { pairs: [], lookingForPartner: [], available: [] };
// The session's cutoff (13:00 NZDT on 2027-01-11) is 2027-01-11T00:00:00Z.
const BEFORE_CUTOFF = new Date('2027-01-10T12:00:00Z');
const AFTER_CUTOFF = new Date('2027-01-11T02:00:00Z');

describe('deriveSessionActions', () => {
  it('noBridge: no actions regardless of anything else', () => {
    const result = deriveSessionActions(null, session({ kind: 'noBridge', partnerRequired: false }), weekday(), emptyRoster, BEFORE_CUTOFF);
    expect(result.state).toEqual({ kind: 'noBridge' });
    expect(result.canActOnRoster).toBe(false);
  });

  it('locked: no actions once the cutoff has passed, even with no entry', () => {
    const result = deriveSessionActions(null, session(), weekday(), emptyRoster, AFTER_CUTOFF);
    expect(result.state).toEqual({ kind: 'locked' });
  });

  it('locked overrides a Teams-format session', () => {
    const result = deriveSessionActions(null, session({ format: 'Teams', partnerRequired: false }), weekday(), emptyRoster, AFTER_CUTOFF);
    expect(result.state).toEqual({ kind: 'locked' });
  });

  it('teams-format: no own entry yet', () => {
    const result = deriveSessionActions(null, session({ format: 'Teams', partnerRequired: false }), weekday(), emptyRoster, BEFORE_CUTOFF);
    expect(result.state).toEqual({ kind: 'teamsFormat', hasOwnEntry: false });
    expect(result.canActOnRoster).toBe(false);
  });

  it('team: already has a team entry for this session', () => {
    const teamEntry = entry({ status: 'confirmed', teamId: 'team-1', partner: null });
    const result = deriveSessionActions(teamEntry, session({ format: 'Teams', partnerRequired: false }), weekday(), emptyRoster, BEFORE_CUTOFF);
    expect(result.state).toEqual({ kind: 'teamsFormat', hasOwnEntry: true });
  });

  it('no entry/open: free to act, sees claimable/inviteable roster members', () => {
    const roster: SessionRosterView = {
      pairs: [],
      lookingForPartner: [{ memberId: 'member-b', name: 'John Smith' }],
      available: [{ memberId: 'member-c', name: 'Amy Lee' }],
    };
    const result = deriveSessionActions(null, session(), weekday(), roster, BEFORE_CUTOFF);
    expect(result.state).toEqual({ kind: 'noEntryOpen' });
    expect(result.canActOnRoster).toBe(true);
    expect(result.claimableMemberIds).toEqual(['member-b']);
    expect(result.inviteableMemberIds).toEqual(['member-c']);
  });

  it('a cancelled own entry is treated as no entry (free)', () => {
    const cancelled = entry({ status: 'cancelled' });
    const result = deriveSessionActions(cancelled, session(), weekday(), emptyRoster, BEFORE_CUTOFF);
    expect(result.state).toEqual({ kind: 'noEntryOpen' });
  });

  it('solo: looking_for_partner', () => {
    const solo = entry({ status: 'looking_for_partner', partner: null, note: 'call after 5pm' });
    const result = deriveSessionActions(solo, session(), weekday(), emptyRoster, BEFORE_CUTOFF);
    expect(result.state).toEqual({ kind: 'solo', status: 'looking_for_partner', note: 'call after 5pm' });
    expect(result.canActOnRoster).toBe(false);
  });

  it('solo: available', () => {
    const solo = entry({ status: 'available', partner: null });
    const result = deriveSessionActions(solo, session(), weekday(), emptyRoster, BEFORE_CUTOFF);
    expect(result.state).toEqual({ kind: 'solo', status: 'available', note: undefined });
  });

  it('confirmed: paired with a member', () => {
    const paired = entry({ status: 'confirmed', partner: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' } });
    const result = deriveSessionActions(paired, session(), weekday(), emptyRoster, BEFORE_CUTOFF);
    expect(result.state).toEqual({
      kind: 'confirmed',
      partner: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' },
      partnerSubstitute: null,
    });
  });

  it('substituted: covered this week by a stand-in', () => {
    const covered = entry({
      status: 'substituted',
      partner: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' },
      substitute: { kind: 'member', memberId: 'member-c', displayName: 'Amy Lee' },
    });
    const result = deriveSessionActions(covered, session(), weekday(), emptyRoster, BEFORE_CUTOFF);
    expect(result.state).toEqual({
      kind: 'substituted',
      partner: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' },
      substitute: { kind: 'member', memberId: 'member-c', displayName: 'Amy Lee' },
    });
  });

  it('sub: standing in for someone else this week', () => {
    const standIn = entry({
      status: 'confirmed',
      partner: { kind: 'member', memberId: 'member-a', displayName: 'Jane Doe' },
      isSubstituteFor: 'member-b',
    });
    const result = deriveSessionActions(standIn, session(), weekday(), emptyRoster, BEFORE_CUTOFF);
    expect(result.state).toEqual({ kind: 'sub', isSubstituteFor: 'member-b' });
  });
});

describe('describeCancelConsequence', () => {
  it('plain confirmed pairing', () => {
    const e = entry({ partner: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' } });
    expect(describeCancelConsequence(e)).toBe("John Smith will be told you've cancelled and will be shown as looking for a partner.");
  });

  it('confirmed pairing whose partner currently has a substitute', () => {
    const e = entry({
      partner: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' },
      partnerSubstitute: { kind: 'member', memberId: 'member-c', displayName: 'Amy Lee' },
    });
    expect(describeCancelConsequence(e)).toContain('Amy Lee');
    expect(describeCancelConsequence(e)).toContain('will also be cancelled');
  });

  it('visitor partner', () => {
    const e = entry({ partner: { kind: 'visitor', visitorId: 'v1', displayName: 'Bob Visitor' } });
    expect(describeCancelConsequence(e)).toBe('Bob Visitor will no longer be listed as your partner for this session.');
  });

  it('substituted (I am covered this week) — my substitute is promoted', () => {
    const e = entry({
      status: 'substituted',
      partner: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' },
      substitute: { kind: 'member', memberId: 'member-c', displayName: 'Amy Lee' },
    });
    expect(describeCancelConsequence(e)).toBe("Amy Lee will become John Smith's partner for this session, and you will be removed from it.");
  });

  it('I am a substitute standing in for someone else', () => {
    const e = entry({ isSubstituteFor: 'member-b', partner: { kind: 'member', memberId: 'member-a', displayName: 'Jane Doe' } });
    expect(describeCancelConsequence(e)).toMatch(/one-week stand-in arrangement/);
  });

  it('team entry (one-session absence)', () => {
    const e = entry({ teamId: 'team-1', partner: null });
    expect(describeCancelConsequence(e)).toMatch(/team captain/);
  });
});

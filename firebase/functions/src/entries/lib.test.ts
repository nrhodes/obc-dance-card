/**
 * Plain unit tests (no emulator) for the pure helpers in `entries/lib.ts`.
 * `loadSession`, `readEntry`, `writePair`, `repeatPartnerWarning` all take a
 * Firestore transaction and are covered indirectly by the `.emu.test.ts`
 * suites instead.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { describe, expect, it } from 'vitest';
import type { Entry, Member, Programme, Session, WeekdayProgramme } from '@obc/shared';
import { assertForceAllowed, assertSessionOpen, entryId, isFree, isSessionLocked, memberRef } from './lib.js';
import type { Caller } from '../lib/context.js';

describe('entryId', () => {
  it('joins sessionId and memberId with an underscore', () => {
    expect(entryId('monday-pairs-2027-01-12', 'member-1')).toBe('monday-pairs-2027-01-12_member-1');
  });

  it('is the only way the id is built — same inputs, same id, every time', () => {
    const a = entryId('s1', 'm1');
    const b = entryId('s1', 'm1');
    expect(a).toBe(b);
  });
});

describe('isFree', () => {
  const base: Entry = {
    id: 'e1',
    sessionId: 's1',
    date: '2027-01-12',
    weekday: 'monday',
    seriesId: null,
    memberId: 'm1',
    status: 'confirmed',
    partner: null,
    pairingId: null,
    teamId: null,
    teamSessionOnly: false,
    substitute: null,
    partnerSubstitute: null,
    isSubstituteFor: null,
    createdBy: 'm1',
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
  };

  it('is true when there is no entry at all', () => {
    expect(isFree(null)).toBe(true);
    expect(isFree(undefined)).toBe(true);
  });

  it('is true for a cancelled entry', () => {
    expect(isFree({ ...base, status: 'cancelled' })).toBe(true);
  });

  it('is false for any active status', () => {
    for (const status of ['confirmed', 'looking_for_partner', 'available', 'substituted'] as const) {
      expect(isFree({ ...base, status })).toBe(false);
    }
  });
});

describe('memberRef', () => {
  it('builds a member PartnerRef with a joined display name', () => {
    const member = { id: 'm1', firstName: 'Ada', lastName: 'Lovelace' } as Member;
    expect(memberRef(member)).toEqual({ kind: 'member', memberId: 'm1', displayName: 'Ada Lovelace' });
  });
});

describe('assertSessionOpen', () => {
  const programme: Programme = {
    id: '2099',
    year: 2099,
    status: 'published',
    createdAt: '2099-01-01T00:00:00.000Z',
    updatedAt: '2099-01-01T00:00:00.000Z',
  };
  const weekday: WeekdayProgramme = {
    id: 'monday',
    weekday: 'monday',
    label: 'Monday',
    startTime: '13:00',
    seatedByTime: '12:45',
    createdAt: '2099-01-01T00:00:00.000Z',
    updatedAt: '2099-01-01T00:00:00.000Z',
  };
  const futureSession: Session = {
    id: 's1',
    date: '2099-01-12',
    weekday: 'monday',
    seriesId: 'monday-pairs',
    kind: 'series',
    title: 'Pairs',
    partnerRequired: true,
    format: 'Pairs',
    createdAt: '2099-01-01T00:00:00.000Z',
    updatedAt: '2099-01-01T00:00:00.000Z',
  };

  it('passes for an open, unlocked, partner-required session', () => {
    expect(() => assertSessionOpen(futureSession, weekday, programme)).not.toThrow();
  });

  it('rejects an unpublished programme', () => {
    expect(() => assertSessionOpen(futureSession, weekday, { ...programme, status: 'draft' })).toThrow(HttpsError);
  });

  it('rejects a noBridge session', () => {
    expect(() => assertSessionOpen({ ...futureSession, kind: 'noBridge' }, weekday, programme)).toThrow(HttpsError);
  });

  it('rejects a Teams session with a teams-specific message', () => {
    try {
      assertSessionOpen({ ...futureSession, partnerRequired: false, format: 'Teams' }, weekday, programme);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(HttpsError);
      expect((err as HttpsError).message).toMatch(/teams event/i);
    }
  });

  it('rejects a non-Teams session that does not require a partner, with a generic message', () => {
    try {
      assertSessionOpen({ ...futureSession, partnerRequired: false, format: undefined }, weekday, programme);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(HttpsError);
      expect((err as HttpsError).message).not.toMatch(/teams event/i);
    }
  });

  it('rejects a locked (past) session', () => {
    const pastSession: Session = { ...futureSession, date: '2000-01-10' }; // a Monday, long past
    expect(() => assertSessionOpen(pastSession, weekday, programme)).toThrow(HttpsError);
  });

  it('allows a locked session through when force is set', () => {
    const pastSession: Session = { ...futureSession, date: '2000-01-10' };
    expect(() => assertSessionOpen(pastSession, weekday, programme, { force: true })).not.toThrow();
  });

  it('allowTeamsSession lets a Teams session through (cancelEntry cancelling one\'s own team entry)', () => {
    const teamsSession: Session = { ...futureSession, partnerRequired: false, format: 'Teams' };
    expect(() => assertSessionOpen(teamsSession, weekday, programme, { allowTeamsSession: true })).not.toThrow();
  });
});

describe('isSessionLocked', () => {
  const weekday: WeekdayProgramme = {
    id: 'monday',
    weekday: 'monday',
    label: 'Monday',
    startTime: '13:00',
    seatedByTime: '12:45',
    createdAt: '2099-01-01T00:00:00.000Z',
    updatedAt: '2099-01-01T00:00:00.000Z',
  };

  it('is false well before the session starts', () => {
    const session = { date: '2099-01-12' } as Session;
    expect(isSessionLocked(session, weekday, Date.parse('2099-01-01T00:00:00Z'))).toBe(false);
  });

  it('is true once the session has started', () => {
    const session = { date: '2000-01-10' } as Session;
    expect(isSessionLocked(session, weekday, Date.now())).toBe(true);
  });
});

describe('assertForceAllowed', () => {
  const admin: Caller = { uid: 'a1', isAdmin: true, member: {} as Caller['member'] };
  const member: Caller = { uid: 'm1', isAdmin: false, member: {} as Caller['member'] };

  it('allows force=false/undefined for anyone', () => {
    expect(() => assertForceAllowed(member, false)).not.toThrow();
    expect(() => assertForceAllowed(member, undefined)).not.toThrow();
  });

  it('allows force=true for an admin', () => {
    expect(() => assertForceAllowed(admin, true)).not.toThrow();
  });

  it('rejects force=true for a non-admin', () => {
    expect(() => assertForceAllowed(member, true)).toThrow(HttpsError);
  });
});

import { describe, expect, it } from 'vitest';
import type { Entry, Session } from '@obc/shared';
import { matchingSessions, previewBulkAvailability } from './bulkAvailability';

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    date: '2027-01-11', // Monday
    weekday: 'monday',
    seriesId: 'monday-pairs',
    kind: 'series',
    title: 'Monday Pairs',
    partnerRequired: true,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

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

const TODAY = '2027-01-11';

describe('matchingSessions', () => {
  it('matches by weekday', () => {
    const sessions = [session({ id: 'mon', weekday: 'monday' }), session({ id: 'fri', weekday: 'friday', date: '2027-01-15' })];
    expect(matchingSessions(sessions, { weekdays: ['monday'] }, TODAY).map((s) => s.id)).toEqual(['mon']);
  });

  it('clamps the effective start date to today even if fromDate is earlier', () => {
    const sessions = [session({ id: 'past', date: '2027-01-04' }), session({ id: 'today', date: TODAY })];
    const matched = matchingSessions(sessions, { weekdays: ['monday'], fromDate: '2020-01-01' }, TODAY);
    expect(matched.map((s) => s.id)).toEqual(['today']);
  });

  it('respects an explicit toDate upper bound', () => {
    const sessions = [session({ id: 'in-range', date: '2027-01-18' }), session({ id: 'out-of-range', date: '2027-02-01' })];
    const matched = matchingSessions(sessions, { weekdays: ['monday'], toDate: '2027-01-25' }, TODAY);
    expect(matched.map((s) => s.id)).toEqual(['in-range']);
  });

  it('excludes noBridge sessions', () => {
    const sessions = [session({ kind: 'noBridge' })];
    expect(matchingSessions(sessions, { weekdays: ['monday'] }, TODAY)).toEqual([]);
  });
});

describe('previewBulkAvailability', () => {
  it('counts a booked session as skipped, not updated', () => {
    const sessions = [session({ id: 's-booked' }), session({ id: 's-free', date: '2027-01-18' })];
    const entries = [entry({ sessionId: 's-booked', status: 'confirmed' })];
    const preview = previewBulkAvailability(sessions, entries, { weekdays: ['monday'] }, TODAY);
    expect(preview).toEqual({ matched: 2, bookedSkipped: 1, toUpdate: 1 });
  });

  it('treats a teamId-bearing entry as booked too', () => {
    const sessions = [session()];
    const entries = [entry({ status: 'looking_for_partner', teamId: 'team-1' })];
    const preview = previewBulkAvailability(sessions, entries, { weekdays: ['monday'] }, TODAY);
    expect(preview).toEqual({ matched: 1, bookedSkipped: 1, toUpdate: 0 });
  });

  it('a solo (looking_for_partner/available/unavailable) or cancelled entry is not counted as booked', () => {
    const sessions = [session({ id: 's-a' }), session({ id: 's-b', date: '2027-01-18' }), session({ id: 's-c', date: '2027-01-25' })];
    const entries = [
      entry({ sessionId: 's-a', status: 'looking_for_partner' }),
      entry({ sessionId: 's-b', status: 'unavailable' }),
      entry({ sessionId: 's-c', status: 'cancelled' }),
    ];
    const preview = previewBulkAvailability(sessions, entries, { weekdays: ['monday'] }, TODAY);
    expect(preview).toEqual({ matched: 3, bookedSkipped: 0, toUpdate: 3 });
  });

  it('zero matches when no weekday is selected', () => {
    const preview = previewBulkAvailability([session()], [], { weekdays: [] }, TODAY);
    expect(preview).toEqual({ matched: 0, bookedSkipped: 0, toUpdate: 0 });
  });
});

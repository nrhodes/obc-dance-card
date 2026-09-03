/**
 * Pure unit tests for `expandBulkSoloStatusSessions` (plan §21 B2) — no
 * emulator involved. Covers the weekday/date-range/kind/lock filtering and
 * the `MAX_BULK_SOLO_STATUS_SESSIONS` cap boundary directly, which is far
 * cheaper than seeding 201 real sessions through the Firestore emulator (see
 * `entries/__tests__/bulkSoloStatus.emu.test.ts` for the integration-level
 * coverage this deliberately leaves to that suite instead).
 */
import { describe, expect, it } from 'vitest';
import { sessionCutoff, type BulkSoloStatusFilter, type Session, type WeekdayProgramme } from '@obc/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  MAX_BULK_SOLO_STATUS_SESSIONS,
  expandBulkSoloStatusSessions,
  type BulkSoloStatusCandidate,
} from './bulkSoloStatus.js';

const TODAY = '2026-09-04';

function weekdayDoc(over: Partial<WeekdayProgramme> = {}): WeekdayProgramme {
  return {
    id: 'monday',
    weekday: 'monday',
    label: 'Monday',
    startTime: '13:00',
    seatedByTime: '12:45',
    createdAt: TODAY,
    updatedAt: TODAY,
    ...over,
  };
}

function session(over: Partial<Session> & Pick<Session, 'id' | 'date'>): Session {
  return {
    weekday: 'monday',
    seriesId: null,
    kind: 'series',
    title: 'Test session',
    partnerRequired: true,
    createdAt: TODAY,
    updatedAt: TODAY,
    ...over,
  };
}

function candidate(s: Session, wd: WeekdayProgramme = weekdayDoc()): BulkSoloStatusCandidate {
  return { session: s, weekday: wd };
}

// Noon NZT on `TODAY` (NZST is UTC+12 in early September) — comfortably
// before the default 13:00 session start time, so a `TODAY`-dated session
// with the default `weekdayDoc()` is not yet locked at this `NOW`.
const NOW = new Date(`${TODAY}T00:00:00Z`).getTime();

describe('expandBulkSoloStatusSessions', () => {
  it('only matches sessions on a requested weekday', () => {
    const filter: BulkSoloStatusFilter = { weekdays: ['monday'] };
    const monday = session({ id: 's-mon', date: '2026-09-07', weekday: 'monday' });
    const wednesday = session({ id: 's-wed', date: '2026-09-09', weekday: 'wednesday' });
    const wdWed = weekdayDoc({ id: 'wednesday', weekday: 'wednesday' });

    const result = expandBulkSoloStatusSessions(
      [candidate(monday), candidate(wednesday, wdWed)],
      filter,
      TODAY,
      NOW,
    );

    expect(result.map((s) => s.id)).toEqual(['s-mon']);
  });

  it('matches every requested weekday when several are given', () => {
    const filter: BulkSoloStatusFilter = { weekdays: ['monday', 'wednesday'] };
    const monday = session({ id: 's-mon', date: '2026-09-07', weekday: 'monday' });
    const wednesday = session({ id: 's-wed', date: '2026-09-09', weekday: 'wednesday' });
    const wdWed = weekdayDoc({ id: 'wednesday', weekday: 'wednesday' });

    const result = expandBulkSoloStatusSessions(
      [candidate(monday), candidate(wednesday, wdWed)],
      filter,
      TODAY,
      NOW,
    );

    expect(result.map((s) => s.id).sort()).toEqual(['s-mon', 's-wed']);
  });

  it('clamps an earlier fromDate up to today, but honours a later one', () => {
    const past = session({ id: 's-past', date: '2026-08-01' });
    const todaySession = session({ id: 's-today', date: TODAY });
    const later = session({ id: 's-later', date: '2026-10-01' });

    const clampedToToday = expandBulkSoloStatusSessions(
      [candidate(past), candidate(todaySession), candidate(later)],
      { weekdays: ['monday'], fromDate: '2020-01-01' },
      TODAY,
      NOW,
    );
    expect(clampedToToday.map((s) => s.id)).toEqual(['s-today', 's-later']);

    const honoursLaterFrom = expandBulkSoloStatusSessions(
      [candidate(past), candidate(todaySession), candidate(later)],
      { weekdays: ['monday'], fromDate: '2026-09-15' },
      TODAY,
      NOW,
    );
    expect(honoursLaterFrom.map((s) => s.id)).toEqual(['s-later']);
  });

  it('has no upper bound when toDate is absent, but excludes past it when given', () => {
    const inRange = session({ id: 's-in', date: '2026-09-10' });
    const farFuture = session({ id: 's-far', date: '2030-01-01' });

    const noUpperBound = expandBulkSoloStatusSessions(
      [candidate(inRange), candidate(farFuture)],
      { weekdays: ['monday'] },
      TODAY,
      NOW,
    );
    expect(noUpperBound.map((s) => s.id).sort()).toEqual(['s-far', 's-in']);

    const bounded = expandBulkSoloStatusSessions(
      [candidate(inRange), candidate(farFuture)],
      { weekdays: ['monday'], toDate: '2026-12-31' },
      TODAY,
      NOW,
    );
    expect(bounded.map((s) => s.id)).toEqual(['s-in']);
  });

  it('excludes noBridge sessions', () => {
    const bookable = session({ id: 's-series', date: '2026-09-07', kind: 'series' });
    const noBridge = session({ id: 's-nobridge', date: '2026-09-14', kind: 'noBridge' });

    const result = expandBulkSoloStatusSessions([candidate(bookable), candidate(noBridge)], { weekdays: ['monday'] }, TODAY, NOW);
    expect(result.map((s) => s.id)).toEqual(['s-series']);
  });

  it('excludes a locked session (cutoff already passed) but keeps an unlocked one', () => {
    const wd = weekdayDoc({ startTime: '13:00' });
    const cutoff = sessionCutoff(TODAY, wd.startTime).getTime();

    const stillOpen = session({ id: 's-open', date: TODAY });
    const alreadyLocked = session({ id: 's-locked', date: TODAY });

    const result = expandBulkSoloStatusSessions(
      [candidate(stillOpen, wd), candidate(alreadyLocked, wd)],
      { weekdays: ['monday'] },
      TODAY,
      cutoff + 1000, // one second after this exact session's cutoff
    );
    expect(result.map((s) => s.id)).toEqual([]); // both share the same date/startTime — both locked at this `now`

    const beforeCutoff = expandBulkSoloStatusSessions(
      [candidate(stillOpen, wd), candidate(alreadyLocked, wd)],
      { weekdays: ['monday'] },
      TODAY,
      cutoff - 1000,
    );
    expect(beforeCutoff.map((s) => s.id).sort()).toEqual(['s-locked', 's-open']);
  });

  it('returns results sorted by date', () => {
    const later = session({ id: 's-later', date: '2026-09-21' });
    const earlier = session({ id: 's-earlier', date: '2026-09-07' });

    const result = expandBulkSoloStatusSessions([candidate(later), candidate(earlier)], { weekdays: ['monday'] }, TODAY, NOW);
    expect(result.map((s) => s.id)).toEqual(['s-earlier', 's-later']);
  });

  it('allows exactly MAX_BULK_SOLO_STATUS_SESSIONS sessions', () => {
    const candidates: BulkSoloStatusCandidate[] = Array.from({ length: MAX_BULK_SOLO_STATUS_SESSIONS }, (_, i) =>
      candidate(session({ id: `s-${i}`, date: '2026-09-07' })),
    );
    const result = expandBulkSoloStatusSessions(candidates, { weekdays: ['monday'] }, TODAY, NOW);
    expect(result).toHaveLength(MAX_BULK_SOLO_STATUS_SESSIONS);
  });

  it('throws failed-precondition just past the cap', () => {
    const candidates: BulkSoloStatusCandidate[] = Array.from({ length: MAX_BULK_SOLO_STATUS_SESSIONS + 1 }, (_, i) =>
      candidate(session({ id: `s-${i}`, date: '2026-09-07' })),
    );
    try {
      expandBulkSoloStatusSessions(candidates, { weekdays: ['monday'] }, TODAY, NOW);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(HttpsError);
      expect((err as HttpsError).code).toBe('failed-precondition');
      expect((err as HttpsError).message).toContain('200');
    }
  });
});

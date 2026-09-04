import { describe, expect, it } from 'vitest';
import type { Entry, Session } from '@obc/shared';
import { buildAgenda, buildMonthGrid, buildYearOverview, dayStatus, sessionMemberStatus } from './overview';

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's-2027-01-11',
    date: '2027-01-11', // a Monday
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
    sessionId: 's-2027-01-11',
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

const TODAY = '2027-01-11'; // Monday

describe('sessionMemberStatus', () => {
  it('open when there is no entry', () => {
    expect(sessionMemberStatus(session(), [])).toBe('open');
  });

  it('open when the entry is cancelled', () => {
    expect(sessionMemberStatus(session(), [entry({ status: 'cancelled' })])).toBe('open');
  });

  it('booked for confirmed/substituted/teamId entries', () => {
    expect(sessionMemberStatus(session(), [entry({ status: 'confirmed' })])).toBe('booked');
    expect(sessionMemberStatus(session(), [entry({ status: 'substituted' })])).toBe('booked');
    expect(sessionMemberStatus(session(), [entry({ status: 'looking_for_partner', teamId: 'team-1' })])).toBe('booked');
  });

  it('seeking for looking_for_partner/available', () => {
    expect(sessionMemberStatus(session(), [entry({ status: 'looking_for_partner' })])).toBe('seeking');
    expect(sessionMemberStatus(session(), [entry({ status: 'available' })])).toBe('seeking');
  });

  it('unavailable for an unavailable entry', () => {
    expect(sessionMemberStatus(session(), [entry({ status: 'unavailable' })])).toBe('unavailable');
  });
});

describe('dayStatus', () => {
  it('none for a past day, regardless of what was on it', () => {
    expect(dayStatus('2020-01-06', [session({ date: '2020-01-06' })], [entry({ sessionId: 's-past', status: 'confirmed', date: '2020-01-06' })], TODAY)).toBe(
      'none',
    );
  });

  it('none when there is no bookable session that day', () => {
    expect(dayStatus(TODAY, [], [], TODAY)).toBe('none');
  });

  it('none when the only session that day is noBridge', () => {
    expect(dayStatus(TODAY, [session({ kind: 'noBridge' })], [], TODAY)).toBe('none');
  });

  it('booked when the single session that day is booked', () => {
    expect(dayStatus(TODAY, [session()], [entry({ status: 'confirmed' })], TODAY)).toBe('booked');
  });

  it('open when the single session that day has no active entry', () => {
    expect(dayStatus(TODAY, [session()], [], TODAY)).toBe('open');
  });

  it('seeking when not booked but posted looking_for_partner/available', () => {
    expect(dayStatus(TODAY, [session()], [entry({ status: 'looking_for_partner' })], TODAY)).toBe('seeking');
  });

  it('unavailable when the single session is marked unavailable', () => {
    expect(dayStatus(TODAY, [session()], [entry({ status: 'unavailable' })], TODAY)).toBe('unavailable');
  });

  describe('multi-session day', () => {
    const sessions = [session({ id: 's-a' }), session({ id: 's-b' })];

    it('booked only when every session that day is booked', () => {
      const entries = [entry({ sessionId: 's-a', status: 'confirmed' }), entry({ id: 'e2', sessionId: 's-b', status: 'confirmed' })];
      expect(dayStatus(TODAY, sessions, entries, TODAY)).toBe('booked');
    });

    it('partly when booked for some sessions but not all', () => {
      const entries = [entry({ sessionId: 's-a', status: 'confirmed' })];
      expect(dayStatus(TODAY, sessions, entries, TODAY)).toBe('partly');
    });

    it('partly takes priority over seeking (booked + open elsewhere)', () => {
      const entries = [entry({ sessionId: 's-a', status: 'confirmed' }), entry({ id: 'e2', sessionId: 's-b', status: 'looking_for_partner' })];
      expect(dayStatus(TODAY, sessions, entries, TODAY)).toBe('partly');
    });

    it('seeking when not booked anywhere but seeking on at least one session', () => {
      const entries = [entry({ sessionId: 's-a', status: 'looking_for_partner' })];
      expect(dayStatus(TODAY, sessions, entries, TODAY)).toBe('seeking');
    });

    it('unavailable only when every session that day is covered by an unavailable entry', () => {
      const entries = [entry({ sessionId: 's-a', status: 'unavailable' }), entry({ id: 'e2', sessionId: 's-b', status: 'unavailable' })];
      expect(dayStatus(TODAY, sessions, entries, TODAY)).toBe('unavailable');
    });

    it('a partial unavailable (some covered, one open) reads as open, not unavailable', () => {
      const entries = [entry({ sessionId: 's-a', status: 'unavailable' })];
      expect(dayStatus(TODAY, sessions, entries, TODAY)).toBe('open');
    });
  });
});

describe('buildAgenda', () => {
  it('omits days with no bookable session, including weekends', () => {
    const sessions = [session({ id: 's-mon', date: '2027-01-11', weekday: 'monday' }), session({ id: 's-fri', date: '2027-01-15', weekday: 'friday' })];
    const agenda = buildAgenda('2027-01-11', 7, sessions, []);
    expect(agenda.map((d) => d.date)).toEqual(['2027-01-11', '2027-01-15']);
  });

  it('carries a year derived from the session date and the per-session status', () => {
    const sessions = [session()];
    const entries = [entry({ status: 'confirmed' })];
    const agenda = buildAgenda('2027-01-11', 1, sessions, entries);
    expect(agenda).toHaveLength(1);
    expect(agenda[0]!.sessions).toEqual([{ session: sessions[0], year: 2027, status: 'booked' }]);
  });

  it('excludes noBridge sessions', () => {
    const sessions = [session({ kind: 'noBridge' })];
    expect(buildAgenda('2027-01-11', 1, sessions, [])).toEqual([]);
  });
});

describe('buildMonthGrid', () => {
  it('produces Mon-Fri weeks only (no weekend columns), 5 wide, every week', () => {
    const weeks = buildMonthGrid(2027, 1, [], [], '2027-01-01');
    for (const week of weeks) {
      expect(week).toHaveLength(5);
    }
  });

  it('pads the leading week so day 1 lands in the correct weekday column', () => {
    // 2027-01-01 is a Friday -> column index 4 (Mon=0..Fri=4).
    const weeks = buildMonthGrid(2027, 1, [], [], '2027-01-01');
    const firstWeek = weeks[0]!;
    expect(firstWeek[0]).toBeNull();
    expect(firstWeek[1]).toBeNull();
    expect(firstWeek[2]).toBeNull();
    expect(firstWeek[3]).toBeNull();
    expect(firstWeek[4]?.dayOfMonth).toBe(1);
  });

  it('skips Saturday/Sunday dates entirely (no cell, not even a blank slot for them)', () => {
    // February 2027 (28 days, non-leap) starts on a Monday, so it's exactly
    // 4 clean Mon-Fri/Sat-Sun weeks: 20 weekday cells, 8 weekend days that
    // never get a cell at all (not even a `null` padding slot).
    const weeks = buildMonthGrid(2027, 2, [], [], '2027-02-01');
    const totalDayCells = weeks.flat().filter((c) => c != null).length;
    expect(totalDayCells).toBe(20);
    expect(weeks.every((week) => week.length === 5)).toBe(true);
  });

  it('carries the right day-status per cell, from sessions/entries', () => {
    const sessions = [session({ date: '2027-01-11' })];
    const entries = [entry({ status: 'confirmed' })];
    const weeks = buildMonthGrid(2027, 1, sessions, entries, '2027-01-01');
    const cell = weeks.flat().find((c) => c?.date === '2027-01-11');
    expect(cell?.status).toBe('booked');
    expect(cell?.sessions).toEqual(sessions);
  });

  it('crosses a month boundary correctly (e.g. April -> May)', () => {
    // 2027-04-30 is a Friday (the last weekday of April); 2027-05-01/02 fall
    // on the weekend, so May's grid picks back up on Monday the 3rd.
    const aprilWeeks = buildMonthGrid(2027, 4, [], [], '2027-04-01');
    const lastAprilCell = aprilWeeks.flat().filter((c) => c != null).pop();
    expect(lastAprilCell?.date).toBe('2027-04-30');
    const mayWeeks = buildMonthGrid(2027, 5, [], [], '2027-05-01');
    const firstMayCell = mayWeeks.flat().find((c) => c != null);
    expect(firstMayCell?.date).toBe('2027-05-03');
  });
});

describe('buildYearOverview', () => {
  it('builds all 12 months', () => {
    const overview = buildYearOverview(2027, [], [], '2027-01-01');
    expect(overview.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('reflects a booked session in the right month/day cell', () => {
    const sessions = [session({ id: 's-2027-03-08', date: '2027-03-08', weekday: 'monday' })];
    const entries = [entry({ sessionId: 's-2027-03-08', status: 'confirmed' })];
    const overview = buildYearOverview(2027, sessions, entries, '2027-01-01');
    const march = overview.find((m) => m.month === 3)!;
    const cell = march.weeks.flat().find((c) => c?.date === '2027-03-08');
    expect(cell?.status).toBe('booked');
  });

  it('pads every month to exactly 6 week rows so the year grid lines up', () => {
    const overview = buildYearOverview(2026, [], [], '2026-01-01');
    for (const m of overview) {
      expect(m.weeks).toHaveLength(6);
    }
    // Padding rows are all-blank, never truncation: every real day survives.
    const feb = overview.find((m) => m.month === 2)!;
    const days = feb.weeks.flat().filter((c) => c != null);
    // Feb 2026 has 20 weekdays (Mon-Fri).
    expect(days).toHaveLength(20);
  });
});

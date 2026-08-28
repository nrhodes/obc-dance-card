import { describe, expect, it } from 'vitest';
import type { Series, Session } from '@obc/shared';
import { WEEKDAYS } from '@obc/shared';
import { buildWeekdayTimeline, defaultProgrammeWeekday, weekdaysWithData } from './programmeView';

function series(overrides: Partial<Series>): Series {
  return {
    id: 'monday-series',
    weekday: 'monday',
    name: 'Series',
    scoring: 'Scr',
    format: 'Pairs',
    bestOf: null,
    allowSubstitute: true,
    order: 0,
    sessionIds: [],
    teamMin: 4,
    teamMax: 6,
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function session(overrides: Partial<Session>): Session {
  return {
    id: 'session-1',
    date: '2027-01-11',
    weekday: 'monday',
    seriesId: null,
    kind: 'series',
    title: 'Series',
    partnerRequired: true,
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildWeekdayTimeline', () => {
  it('groups a series into one card with its sessions in date order', () => {
    const s = series({ id: 'series-a', order: 0 });
    const sessions = [
      session({ id: 'series-a-2027-01-18', seriesId: 'series-a', date: '2027-01-18' }),
      session({ id: 'series-a-2027-01-11', seriesId: 'series-a', date: '2027-01-11' }),
    ];
    const timeline = buildWeekdayTimeline('monday', [s], sessions);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]!.type).toBe('series');
    expect(timeline[0]!.anchorDate).toBe('2027-01-11');
    if (timeline[0]!.type === 'series') {
      expect(timeline[0]!.sessions.map((se) => se.date)).toEqual(['2027-01-11', '2027-01-18']);
    }
  });

  it('interleaves a single (holidayBridge) between two series by date', () => {
    const seriesA = series({ id: 'series-a', order: 0 });
    const seriesB = series({ id: 'series-b', name: 'Series B', order: 1 });
    const sessions = [
      session({ id: 'series-a-1', seriesId: 'series-a', date: '2027-01-11' }),
      session({ id: 'series-a-2', seriesId: 'series-a', date: '2027-01-18' }),
      session({ id: 'holiday-1', seriesId: null, kind: 'holidayBridge', title: 'Holiday Bridge', date: '2027-01-25' }),
      session({ id: 'series-b-1', seriesId: 'series-b', date: '2027-02-01' }),
    ];
    const timeline = buildWeekdayTimeline('monday', [seriesA, seriesB], sessions);
    expect(timeline.map((i) => i.anchorDate)).toEqual(['2027-01-11', '2027-01-25', '2027-02-01']);
    expect(timeline[1]!.type).toBe('single');
  });

  it('excludes series from other weekdays and drops series with no surviving sessions', () => {
    const mondaySeries = series({ id: 'series-a', weekday: 'monday' });
    const fridaySeries = series({ id: 'series-b', weekday: 'friday' });
    const emptySeries = series({ id: 'series-empty', weekday: 'monday' });
    const sessions = [session({ id: 's1', seriesId: 'series-a', date: '2027-01-11' })];
    const timeline = buildWeekdayTimeline('monday', [mondaySeries, fridaySeries, emptySeries], sessions);
    expect(timeline).toHaveLength(1);
  });
});

describe('weekdaysWithData', () => {
  it('filters WEEKDAYS to only those present, keeping WEEKDAYS order', () => {
    expect(weekdaysWithData(['friday', 'monday'], WEEKDAYS)).toEqual(['monday', 'friday']);
  });
});

describe('defaultProgrammeWeekday', () => {
  it('returns today when today is a weekday (NZ)', () => {
    expect(defaultProgrammeWeekday(new Date('2027-01-11T00:00:00Z'))).toBe('monday');
  });

  it('falls back to Monday on a weekend (NZ)', () => {
    expect(defaultProgrammeWeekday(new Date('2027-01-16T00:00:00Z'))).toBe('monday');
  });
});

import { describe, expect, it } from 'vitest';
import type { Series, Session } from '@obc/shared';
import { WEEKDAYS } from '@obc/shared';
import { buildWeekdayTimeline, defaultProgrammeWeekday, weekdaysWithData } from './programmeView';

type Tagged<T> = T & { year: number };

function series(overrides: Partial<Series> & { year: number }): Tagged<Series> {
  const { year, ...seriesOverrides } = overrides;
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
    ...seriesOverrides,
    year,
  };
}

function session(overrides: Partial<Session> & { year: number }): Tagged<Session> {
  const { year, ...sessionOverrides } = overrides;
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
    ...sessionOverrides,
    year,
  };
}

describe('buildWeekdayTimeline', () => {
  it('groups a series into one card with its sessions in date order', () => {
    const s = series({ id: 'series-a', order: 0, year: 2027 });
    const sessions = [
      session({ id: 'series-a-2027-01-18', seriesId: 'series-a', date: '2027-01-18', year: 2027 }),
      session({ id: 'series-a-2027-01-11', seriesId: 'series-a', date: '2027-01-11', year: 2027 }),
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
    const seriesA = series({ id: 'series-a', order: 0, year: 2027 });
    const seriesB = series({ id: 'series-b', name: 'Series B', order: 1, year: 2027 });
    const sessions = [
      session({ id: 'series-a-1', seriesId: 'series-a', date: '2027-01-11', year: 2027 }),
      session({ id: 'series-a-2', seriesId: 'series-a', date: '2027-01-18', year: 2027 }),
      session({ id: 'holiday-1', seriesId: null, kind: 'holidayBridge', title: 'Holiday Bridge', date: '2027-01-25', year: 2027 }),
      session({ id: 'series-b-1', seriesId: 'series-b', date: '2027-02-01', year: 2027 }),
    ];
    const timeline = buildWeekdayTimeline('monday', [seriesA, seriesB], sessions);
    expect(timeline.map((i) => i.anchorDate)).toEqual(['2027-01-11', '2027-01-25', '2027-02-01']);
    expect(timeline[1]!.type).toBe('single');
  });

  it('excludes series from other weekdays and drops series with no surviving sessions', () => {
    const mondaySeries = series({ id: 'series-a', weekday: 'monday', year: 2027 });
    const fridaySeries = series({ id: 'series-b', weekday: 'friday', year: 2027 });
    const emptySeries = series({ id: 'series-empty', weekday: 'monday', year: 2027 });
    const sessions = [session({ id: 's1', seriesId: 'series-a', date: '2027-01-11', year: 2027 })];
    const timeline = buildWeekdayTimeline('monday', [mondaySeries, fridaySeries, emptySeries], sessions);
    expect(timeline).toHaveLength(1);
  });

  // plan §21 B3 id-collision note: `seriesId` is `${weekday}-${slug(name)}`
  // and can collide across years — two different years each running a
  // "Monday Pairs" series would both slug to `monday-pairs`. A series card's
  // sessions must only attach when *both* `seriesId` and `year` match, or a
  // member could see the wrong year's sessions folded into one card.
  describe('cross-year seriesId collision', () => {
    const collidingId = 'monday-pairs';

    it('keeps two different years\' series (same seriesId) as separate cards, each with only its own year\'s sessions', () => {
      const series2026 = series({ id: collidingId, name: '2026 Pairs', year: 2026 });
      const series2027 = series({ id: collidingId, name: '2027 Pairs', year: 2027 });
      const sessions = [
        session({ id: 's-2026-1', seriesId: collidingId, date: '2026-01-05', year: 2026 }),
        session({ id: 's-2027-1', seriesId: collidingId, date: '2027-01-11', year: 2027 }),
      ];
      const timeline = buildWeekdayTimeline('monday', [series2026, series2027], sessions);

      expect(timeline).toHaveLength(2);
      const seriesItems = timeline.filter((i) => i.type === 'series');
      expect(seriesItems).toHaveLength(2);

      const item2026 = seriesItems.find((i) => i.type === 'series' && i.year === 2026);
      const item2027 = seriesItems.find((i) => i.type === 'series' && i.year === 2027);
      expect(item2026?.type === 'series' && item2026.series.name).toBe('2026 Pairs');
      expect(item2027?.type === 'series' && item2027.series.name).toBe('2027 Pairs');
      expect(item2026?.type === 'series' && item2026.sessions.map((s) => s.id)).toEqual(['s-2026-1']);
      expect(item2027?.type === 'series' && item2027.sessions.map((s) => s.id)).toEqual(['s-2027-1']);
    });

    it('never attaches an older year\'s session to a newer year\'s same-id series, or vice versa', () => {
      const series2026 = series({ id: collidingId, name: '2026 Pairs', year: 2026 });
      const sessions2027Only = [session({ id: 's-2027-1', seriesId: collidingId, date: '2027-01-11', year: 2027 })];
      // 2026's series exists, but every session tagged `seriesId: collidingId` is year 2027 —
      // the 2026 card must have zero sessions attached, and therefore be dropped (empty series aren't rendered).
      const timeline = buildWeekdayTimeline('monday', [series2026], sessions2027Only);
      expect(timeline.filter((i) => i.type === 'series')).toHaveLength(0);
    });
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

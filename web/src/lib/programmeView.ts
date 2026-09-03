/**
 * Pure grouping/ordering helpers for the programme browser (plan Phase 2b
 * task): series render as one card (all its session dates inside), while
 * Holiday-Bridge / No-Bridge singles are interleaved between series cards by
 * date, mirroring how the printed booklet lays a weekday's page out — not
 * bucketed into a separate "singles" section.
 *
 * Extended by plan §21 B3 (two-year horizon): `series`/`sessions` now come
 * from `useProgramme()`'s *merged*, year-tagged arrays, spanning every
 * currently-published year. `seriesId` is `${weekday}-${slug(name)}` and can
 * collide across years (two different years each running a series slugging
 * to `monday-x`), so a series card's sessions are only ever attached when
 * both `seriesId` *and* `year` match — never id alone.
 */
import { todayNZ, weekdayOfNZ, type Series, type Session, type Weekday } from '@obc/shared';

type Tagged<T> = T & { year: number };

export interface SeriesTimelineItem {
  type: 'series';
  series: Tagged<Series>;
  /** This series' sessions (same year as the series), in date order. */
  sessions: Tagged<Session>[];
  anchorDate: string;
  year: number;
}

export interface SingleTimelineItem {
  type: 'single';
  session: Tagged<Session>;
  anchorDate: string;
  year: number;
}

export type WeekdayTimelineItem = SeriesTimelineItem | SingleTimelineItem;

/**
 * Builds one weekday's timeline: series cards and single sessions, in date
 * order, across every loaded year. A series' sessions are matched by
 * `seriesId` *and* `year` (see module doc) so two different years' series
 * that happen to slug to the same id never cross-attach each other's
 * sessions.
 */
export function buildWeekdayTimeline(
  weekday: Weekday,
  series: Tagged<Series>[],
  sessions: Tagged<Session>[],
): WeekdayTimelineItem[] {
  const items: WeekdayTimelineItem[] = [];

  const seriesForWeekday = series
    .filter((s) => s.weekday === weekday)
    .sort((a, b) => a.year - b.year || a.order - b.order);
  for (const s of seriesForWeekday) {
    const seriesSessions = sessions
      .filter((se) => se.seriesId === s.id && se.year === s.year)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (seriesSessions.length === 0) continue;
    items.push({ type: 'series', series: s, sessions: seriesSessions, anchorDate: seriesSessions[0]!.date, year: s.year });
  }

  const singles = sessions.filter((se) => se.weekday === weekday && se.seriesId == null);
  for (const session of singles) {
    items.push({ type: 'single', session, anchorDate: session.date, year: session.year });
  }

  return items.sort((a, b) => a.anchorDate.localeCompare(b.anchorDate));
}

/** Today's weekday (NZ) if it's Mon-Fri, else Monday — the programme browser's default tab. */
export function defaultProgrammeWeekday(now: Date = new Date()): Weekday {
  try {
    return weekdayOfNZ(todayNZ(now));
  } catch {
    return 'monday';
  }
}

/** Weekdays that actually have programme data, in `WEEKDAYS` order (callers pass the full weekdays list). */
export function weekdaysWithData(weekdayIds: Weekday[], allWeekdays: readonly Weekday[]): Weekday[] {
  const present = new Set(weekdayIds);
  return allWeekdays.filter((w) => present.has(w));
}

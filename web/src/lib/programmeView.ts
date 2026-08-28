/**
 * Pure grouping/ordering helpers for the programme browser (plan Phase 2b
 * task): series render as one card (all its session dates inside), while
 * Holiday-Bridge / No-Bridge singles are interleaved between series cards by
 * date, mirroring how the printed booklet lays a weekday's page out — not
 * bucketed into a separate "singles" section.
 */
import { todayNZ, weekdayOfNZ, type Series, type Session, type Weekday } from '@obc/shared';

export interface SeriesTimelineItem {
  type: 'series';
  series: Series;
  /** This series' sessions, in date order. */
  sessions: Session[];
  anchorDate: string;
}

export interface SingleTimelineItem {
  type: 'single';
  session: Session;
  anchorDate: string;
}

export type WeekdayTimelineItem = SeriesTimelineItem | SingleTimelineItem;

/** Builds one weekday's timeline: series cards and single sessions, in date order. */
export function buildWeekdayTimeline(weekday: Weekday, series: Series[], sessions: Session[]): WeekdayTimelineItem[] {
  const items: WeekdayTimelineItem[] = [];

  const seriesForWeekday = series.filter((s) => s.weekday === weekday).sort((a, b) => a.order - b.order);
  for (const s of seriesForWeekday) {
    const seriesSessions = sessions
      .filter((se) => se.seriesId === s.id)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (seriesSessions.length === 0) continue;
    items.push({ type: 'series', series: s, sessions: seriesSessions, anchorDate: seriesSessions[0]!.date });
  }

  const singles = sessions.filter((se) => se.weekday === weekday && se.seriesId == null);
  for (const session of singles) {
    items.push({ type: 'single', session, anchorDate: session.date });
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

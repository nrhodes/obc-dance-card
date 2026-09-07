/**
 * Pure (no React, no Firestore) view-model for the Calendar screen (plan §21
 * B4 "Calendar overview", B2 bulk-availability preview). Everything here is
 * derived from a member's `entries` plus the loaded programme's `sessions`
 * (never touching Firestore or `useProgramme` directly), so it is
 * unit-testable without mounting React.
 *
 * Day-status taxonomy for a member + calendar date (see `dayStatus`):
 * - `none`        no bookable session that day, or the day is already past
 *                  (a past day is always muted/inert regardless of what was
 *                  on it — the calendar looks forward, not back).
 * - `booked`      a booked entry (`confirmed`/`substituted`, or any
 *                  `teamId`-bearing entry — plan §5.6) for *every* bookable
 *                  session that day (the common case: one session/day).
 * - `partly`      booked for *some* of that day's bookable sessions, not all
 *                  (only possible on a multi-session day).
 * - `seeking`     not booked anywhere that day, but has a
 *                  `looking_for_partner`/`available` entry on at least one
 *                  of that day's sessions.
 * - `unavailable` not booked/seeking, and an `unavailable` entry covers
 *                  *every* bookable session that day — if only some are
 *                  covered, the day reads as `open` instead (there's still
 *                  something to book).
 * - `open`        a bookable session exists that the member has no active
 *                  relationship with — the whole point of the year/month
 *                  views is to make these easy to spot.
 *
 * All date math goes through `@obc/shared`'s NZ-local helpers
 * (`todayNZ`/`addDaysNZ`/`weekdayOfNZ`); `weekdayOfNZ` throws for
 * Saturday/Sunday (the club only runs Monday-Friday), so every place that
 * walks raw calendar dates either skips the weekend day entirely (the
 * month/year grids, which have no weekend columns) or never needs it in the
 * first place (the agenda only ever looks at dates sessions actually exist
 * on, which are always weekdays).
 *
 * `Session` already denormalises `title`/`format` (plan §5.4), so none of
 * these builders need a `series` lookup to label a session — and a
 * `seriesId`-keyed lookup would risk the cross-year collision plan §21 B3
 * calls out (`${weekday}-${slug(name)}` can repeat across published years).
 *
 * The Month/Year grids also carry a *series* channel (plan §21 "Calendar
 * series bands"), independent of the member-status colour above: each day
 * whose sessions belong to a series gets a left-edge stripe, alternating
 * between two tints down a weekday column so consecutive occurrences of one
 * series read as one visual band and the next series flips — see
 * `computeSeriesBands` for the exact rule. Naming a series band *does* need
 * a lookup against the year-tagged `series` array (unlike the title/format
 * denormalisation above), so it uses the same year-qualified pattern as
 * `lib/card.ts#cardSessionTitle` — a bare `seriesId` match is not safe.
 */
import { addDaysNZ, todayNZ, weekdayOfNZ, type Entry, type IsoDate, type Series, type Session, type Weekday } from '@obc/shared';

/**
 * `series` may come from `useProgramme()`'s merged, multi-year view (each
 * item tagged with its year) or a plain single-year fixture (`year`
 * absent) — mirrors `lib/card.ts`'s `Tagged<T>`.
 */
type Tagged<T> = T & { year?: number };

export type DayStatus = 'none' | 'booked' | 'partly' | 'seeking' | 'unavailable' | 'open';

/** Per-session member status — the building block `dayStatus` aggregates over a day's bookable sessions. */
export type SessionMemberStatus = 'booked' | 'seeking' | 'unavailable' | 'open';

/** A booked entry occupies the slot outright (mirrors `entries/lib.ts#isBooked` server-side). */
export function isBookedEntry(entry: Entry): boolean {
  return entry.status === 'confirmed' || entry.status === 'substituted' || entry.teamId != null;
}

function isSeekingEntry(entry: Entry): boolean {
  return entry.status === 'looking_for_partner' || entry.status === 'available';
}

/** The member's non-cancelled entry for `session`, if any. */
function entryFor(session: Session, entries: readonly Entry[]): Entry | undefined {
  return entries.find((e) => e.sessionId === session.id && e.status !== 'cancelled');
}

/** One bookable session's status for this member — `open` when there is no active entry. */
export function sessionMemberStatus(session: Session, entries: readonly Entry[]): SessionMemberStatus {
  const entry = entryFor(session, entries);
  if (!entry) return 'open';
  if (isBookedEntry(entry)) return 'booked';
  if (isSeekingEntry(entry)) return 'seeking';
  if (entry.status === 'unavailable') return 'unavailable';
  return 'open';
}

/** Every bookable (`kind !== 'noBridge'`) session on `date`. */
function bookableSessionsOn(date: IsoDate, sessions: readonly Session[]): Session[] {
  return sessions.filter((s) => s.date === date && s.kind !== 'noBridge');
}

/**
 * The day-level status for one member + calendar date, from that date's
 * bookable sessions and the member's entries. See the taxonomy above.
 */
export function dayStatus(
  date: IsoDate,
  sessions: readonly Session[],
  entries: readonly Entry[],
  today: IsoDate = todayNZ(),
): DayStatus {
  if (date < today) return 'none';
  const daySessions = bookableSessionsOn(date, sessions);
  if (daySessions.length === 0) return 'none';

  const statuses = daySessions.map((s) => sessionMemberStatus(s, entries));
  const bookedCount = statuses.filter((s) => s === 'booked').length;
  if (bookedCount === daySessions.length) return 'booked';
  if (bookedCount > 0) return 'partly';
  if (statuses.some((s) => s === 'seeking')) return 'seeking';
  if (statuses.every((s) => s === 'unavailable')) return 'unavailable';
  return 'open';
}

/* --------------------------------- agenda -------------------------------- */

export interface AgendaSessionEntry {
  session: Session;
  /** The year to route to (`/session/:year/:sessionId`) — derived from the session's own date, never a series lookup. */
  year: number;
  status: SessionMemberStatus;
}

export interface AgendaDay {
  date: IsoDate;
  sessions: AgendaSessionEntry[];
}

/**
 * Chronological day buckets starting at `fromDate`, `days` calendar days
 * long, one bucket per day that actually has a bookable session — days with
 * none (including every Saturday/Sunday, which never have sessions) are
 * omitted rather than rendered as empty rows.
 */
export function buildAgenda(fromDate: IsoDate, days: number, sessions: readonly Session[], entries: readonly Entry[]): AgendaDay[] {
  const result: AgendaDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDaysNZ(fromDate, i);
    const daySessions = bookableSessionsOn(date, sessions).sort((a, b) => a.id.localeCompare(b.id));
    if (daySessions.length === 0) continue;
    result.push({
      date,
      sessions: daySessions.map((session) => ({
        session,
        year: Number(session.date.slice(0, 4)),
        status: sessionMemberStatus(session, entries),
      })),
    });
  }
  return result;
}

/* ------------------------------ series bands ------------------------------ */

export type SeriesBand = 'a' | 'b';

/**
 * Alternating stripe assignment (plan §21 "Calendar series bands"): per
 * weekday, per year, order that weekday's series by their *first* session
 * date and alternate band A/B by that order's index — so consecutive
 * occurrences of one series (same weekday, same series, week after week)
 * share a tint, and the next series on that weekday flips to the other
 * tint, the next one flips back, and so on. Parity restarts every year
 * (`Series` docs already live one level under `programmes/{year}`, so this
 * falls out naturally) — carrying a running parity across a year boundary
 * would couple two independently-published years for no real benefit.
 *
 * Returns a lookup keyed `${year}:${seriesId}` — `seriesId` collides across
 * years (plan §21 B3: `${weekday}-${slug(name)}`), so any consumer must key
 * on the pair, never the bare id.
 *
 * Sessions with `seriesId == null` (one-off sessions, e.g. Holiday Bridge)
 * never enter this map — the caller treats "no entry" as "no stripe".
 */
export function computeSeriesBands(sessions: readonly Session[]): Map<string, SeriesBand> {
  // `${year}:${weekday}` -> seriesId -> earliest date seen for that series.
  const firstDateByGroup = new Map<string, Map<string, IsoDate>>();
  for (const s of sessions) {
    if (!s.seriesId) continue;
    const year = Number(s.date.slice(0, 4));
    const groupKey = `${year}:${s.weekday}`;
    let group = firstDateByGroup.get(groupKey);
    if (!group) {
      group = new Map<string, IsoDate>();
      firstDateByGroup.set(groupKey, group);
    }
    const earliest = group.get(s.seriesId);
    if (!earliest || s.date < earliest) group.set(s.seriesId, s.date);
  }

  const bands = new Map<string, SeriesBand>();
  for (const [groupKey, group] of firstDateByGroup) {
    const year = groupKey.slice(0, groupKey.indexOf(':'));
    // `Array.prototype.sort` is stable, so two series with an identical
    // first date (unusual — two series on the same weekday starting the
    // same day) keep the order they were encountered in `sessions`, which
    // is deterministic for a given input rather than arbitrary.
    const ordered = [...group.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    ordered.forEach(([seriesId], index) => {
      bands.set(`${year}:${seriesId}`, index % 2 === 0 ? 'a' : 'b');
    });
  }
  return bands;
}

/** Year-qualified series name lookup — mirrors `lib/card.ts#cardSessionTitle`; falls back to the session's own denormalised `seriesName`/`title` if the series doc isn't loaded. */
function seriesNameFor(seriesId: string, year: number, series: readonly Tagged<Series>[], fallback: Session): string {
  const found = series.find((sr) => sr.id === seriesId && (sr.year == null || sr.year === year));
  return found?.name ?? fallback.seriesName ?? fallback.title;
}

/* ------------------------------ month grid ------------------------------- */

export interface MonthDayCell {
  date: IsoDate;
  dayOfMonth: number;
  status: DayStatus;
  /** That day's bookable sessions — empty for a `none` day. */
  sessions: Session[];
  /**
   * The stripe for this day, from the *first* of `sessions`' series (plan
   * §21: rare multi-series days just use the first — documented, not a bug).
   * `null` for a `none` day or a day whose first session is a one-off
   * (`seriesId == null`).
   */
  seriesBand: SeriesBand | null;
  /** Every distinct series name among that day's sessions, in session order — feeds the aria-label/title (WCAG 1.4.1); empty when none. */
  seriesNames: string[];
}

/** One series' entry in the Month view's key (plan §21): a stripe swatch, name, and that series' session dates within the displayed month, ascending. */
export interface MonthSeriesKeyEntry {
  seriesId: string;
  name: string;
  band: SeriesBand;
  /** Ascending, restricted to the displayed month. */
  dates: IsoDate[];
}

/** One calendar week, Monday..Friday; `null` for a slot outside the month (padding only, never a real weekend column). */
export type MonthWeek = Array<MonthDayCell | null>;

const WEEKDAY_COLUMN: Record<Weekday, number> = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4 };

/** `weekdayOfNZ` throws for Saturday/Sunday (plan §6) — every calendar-day walk in this module goes through this instead. */
function weekdayOfNZOrNull(date: IsoDate): Weekday | null {
  try {
    return weekdayOfNZ(date);
  } catch {
    return null;
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoDate(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface MonthGrid {
  weeks: MonthWeek[];
  /**
   * Every series with a bookable session in this month, first-date order —
   * feeds the Month view's key (plan §21). `buildYearOverview` below calls
   * this once per month too but only keeps `weeks` — Year view renders
   * stripes/labels on its cells only, no key (too dense at 12 months/page).
   */
  seriesKey: MonthSeriesKeyEntry[];
}

/**
 * `year`/`month` (1-12) as Mon-Fri weeks — no weekend columns at all, since
 * the programme never runs Saturday/Sunday. Leading/trailing slots that fall
 * outside the month (so day 1 doesn't have to land in column 0, and the
 * final week is padded out to a full row) are `null`.
 *
 * `series` should be the *full*, multi-year `sessions`/`series` sets a
 * caller already has from `useProgramme()` — band parity (see
 * `computeSeriesBands`) depends on every session in the year, not just the
 * ones landing in this particular month, so narrowing either array to the
 * displayed month before calling this would silently break alternation for
 * any series whose first session falls in an earlier month.
 */
export function buildMonthGrid(
  year: number,
  month: number,
  sessions: readonly Session[],
  entries: readonly Entry[],
  series: readonly Tagged<Series>[] = [],
  today: IsoDate = todayNZ(),
): MonthGrid {
  const bands = computeSeriesBands(sessions);
  const cells: Array<MonthDayCell | null> = [];
  // `seriesId` -> ascending dates, restricted to this month, for the key.
  const keyDatesBySeries = new Map<string, IsoDate[]>();
  const keyNameBySeries = new Map<string, string>();

  const firstWeekday = weekdayOfNZOrNull(isoDate(year, month, 1));
  const leadingBlanks = firstWeekday ? WEEKDAY_COLUMN[firstWeekday] : 0;
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);

  const total = daysInMonth(year, month);
  for (let day = 1; day <= total; day++) {
    const date = isoDate(year, month, day);
    if (!weekdayOfNZOrNull(date)) continue; // Saturday/Sunday: no column for it at all.
    const daySessions = bookableSessionsOn(date, sessions);

    const seriesSessions = daySessions.filter((s) => s.seriesId != null);
    const seriesNames = [...new Set(seriesSessions.map((s) => seriesNameFor(s.seriesId!, year, series, s)))];
    // Multi-session days are rare; when one happens, the stripe follows the
    // *first* session's series (whatever that is, one-off included) — kept
    // simple rather than trying to rank same-day sessions.
    const first = daySessions[0];
    const seriesBand = first?.seriesId ? (bands.get(`${year}:${first.seriesId}`) ?? null) : null;

    for (const s of seriesSessions) {
      const dates = keyDatesBySeries.get(s.seriesId!) ?? [];
      dates.push(date);
      keyDatesBySeries.set(s.seriesId!, dates);
      if (!keyNameBySeries.has(s.seriesId!)) keyNameBySeries.set(s.seriesId!, seriesNameFor(s.seriesId!, year, series, s));
    }

    cells.push({
      date,
      dayOfMonth: day,
      status: dayStatus(date, sessions, entries, today),
      sessions: daySessions,
      seriesBand,
      seriesNames,
    });
  }

  while (cells.length % 5 !== 0) cells.push(null);

  const weeks: MonthWeek[] = [];
  for (let i = 0; i < cells.length; i += 5) weeks.push(cells.slice(i, i + 5));

  const seriesKey: MonthSeriesKeyEntry[] = [...keyDatesBySeries.entries()]
    .map(([seriesId, dates]) => ({
      seriesId,
      name: keyNameBySeries.get(seriesId)!,
      band: bands.get(`${year}:${seriesId}`) ?? 'a',
      dates: [...dates].sort(),
    }))
    .sort((a, b) => a.dates[0]!.localeCompare(b.dates[0]!));

  return { weeks, seriesKey };
}

/* ------------------------------ year overview ----------------------------- */

export interface YearMonthOverview {
  /** 1-12. */
  month: number;
  weeks: MonthWeek[];
}

/**
 * A month spans at most 6 distinct Mon–Fri weeks; the year view pads every
 * month to exactly this many rows (with all-blank weeks) so the twelve
 * mini-month cards are the same height and their week rows line up across
 * columns.
 */
const YEAR_VIEW_WEEK_ROWS = 6;

const BLANK_WEEK: MonthWeek = [null, null, null, null, null];

/**
 * Every month (Jan-Dec) of `year`, each as `buildMonthGrid` would build it
 * alone, padded to a uniform `YEAR_VIEW_WEEK_ROWS` rows (year view only —
 * the full Month view renders exactly the real weeks).
 */
export function buildYearOverview(
  year: number,
  sessions: readonly Session[],
  entries: readonly Entry[],
  series: readonly Tagged<Series>[] = [],
  today: IsoDate = todayNZ(),
): YearMonthOverview[] {
  return Array.from({ length: 12 }, (_, i) => {
    const weeks = [...buildMonthGrid(year, i + 1, sessions, entries, series, today).weeks];
    while (weeks.length < YEAR_VIEW_WEEK_ROWS) weeks.push(BLANK_WEEK);
    return { month: i + 1, weeks };
  });
}

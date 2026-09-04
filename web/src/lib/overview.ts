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
 */
import { addDaysNZ, todayNZ, weekdayOfNZ, type Entry, type IsoDate, type Session, type Weekday } from '@obc/shared';

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

/* ------------------------------ month grid ------------------------------- */

export interface MonthDayCell {
  date: IsoDate;
  dayOfMonth: number;
  status: DayStatus;
  /** That day's bookable sessions — empty for a `none` day. */
  sessions: Session[];
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

/**
 * `year`/`month` (1-12) as Mon-Fri weeks — no weekend columns at all, since
 * the programme never runs Saturday/Sunday. Leading/trailing slots that fall
 * outside the month (so day 1 doesn't have to land in column 0, and the
 * final week is padded out to a full row) are `null`.
 */
export function buildMonthGrid(
  year: number,
  month: number,
  sessions: readonly Session[],
  entries: readonly Entry[],
  today: IsoDate = todayNZ(),
): MonthWeek[] {
  const cells: Array<MonthDayCell | null> = [];

  const firstWeekday = weekdayOfNZOrNull(isoDate(year, month, 1));
  const leadingBlanks = firstWeekday ? WEEKDAY_COLUMN[firstWeekday] : 0;
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);

  const total = daysInMonth(year, month);
  for (let day = 1; day <= total; day++) {
    const date = isoDate(year, month, day);
    if (!weekdayOfNZOrNull(date)) continue; // Saturday/Sunday: no column for it at all.
    cells.push({
      date,
      dayOfMonth: day,
      status: dayStatus(date, sessions, entries, today),
      sessions: bookableSessionsOn(date, sessions),
    });
  }

  while (cells.length % 5 !== 0) cells.push(null);

  const weeks: MonthWeek[] = [];
  for (let i = 0; i < cells.length; i += 5) weeks.push(cells.slice(i, i + 5));
  return weeks;
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
  today: IsoDate = todayNZ(),
): YearMonthOverview[] {
  return Array.from({ length: 12 }, (_, i) => {
    const weeks = [...buildMonthGrid(year, i + 1, sessions, entries, today)];
    while (weeks.length < YEAR_VIEW_WEEK_ROWS) weeks.push(BLANK_WEEK);
    return { month: i + 1, weeks };
  });
}

/**
 * Pure client-side preview for the "Set availability…" bulk dialog (plan §21
 * B2). Mirrors the *display-relevant* subset of the server's
 * `expandBulkSoloStatusSessions` (`firebase/functions/src/entries/bulkSoloStatus.ts`):
 * weekday match, date range clamped to today, and `kind !== 'noBridge'` —
 * enough to tell the member "this will touch N sessions, M of which are
 * already booked and will be left alone" before they confirm.
 *
 * Deliberately does *not* replicate the server's lock check or the 200-session
 * cap: the plan settles that the server enforces both and the preview can say
 * "about N" — reproducing session-cutoff timing client-side would just be
 * another place for the two to drift apart.
 */
import { todayNZ, type Entry, type IsoDate, type Session, type Weekday } from '@obc/shared';
import { isBookedEntry } from './overview';

export interface BulkAvailabilityFilter {
  weekdays: readonly Weekday[];
  fromDate?: IsoDate;
  toDate?: IsoDate;
}

export interface BulkAvailabilityPreview {
  /** Every session the filter matches (weekday + date range + bookable). */
  matched: number;
  /** Of `matched`, how many already have a booked entry and will be left untouched. */
  bookedSkipped: number;
  /** `matched - bookedSkipped` — sessions the action will actually change. */
  toUpdate: number;
}

/** The sessions `previewBulkAvailability` would count as "matched" — exposed for the dialog's date-list summaries. */
export function matchingSessions(sessions: readonly Session[], filter: BulkAvailabilityFilter, today: IsoDate = todayNZ()): Session[] {
  const weekdaySet = new Set<Weekday>(filter.weekdays);
  const from = filter.fromDate && filter.fromDate > today ? filter.fromDate : today;
  return sessions
    .filter((s) => weekdaySet.has(s.weekday))
    .filter((s) => s.kind !== 'noBridge')
    .filter((s) => s.date >= from)
    .filter((s) => !filter.toDate || s.date <= filter.toDate)
    .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));
}

export function previewBulkAvailability(
  sessions: readonly Session[],
  entries: readonly Entry[],
  filter: BulkAvailabilityFilter,
  today: IsoDate = todayNZ(),
): BulkAvailabilityPreview {
  const matched = matchingSessions(sessions, filter, today);
  const bookedSkipped = matched.filter((s) => {
    const entry = entries.find((e) => e.sessionId === s.id && e.status !== 'cancelled');
    return entry != null && isBookedEntry(entry);
  }).length;
  return { matched: matched.length, bookedSkipped, toUpdate: matched.length - bookedSkipped };
}

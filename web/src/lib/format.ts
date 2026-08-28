/**
 * Display formatting helpers. NZ date/time formatting only — no date library
 * (plan §14.1 closed dependency list); implemented with `Intl.DateTimeFormat`
 * against `Pacific/Auckland`, mirroring the approach in `shared/src/time.ts`.
 *
 * `formatDateNZ` takes a stored `IsoDate` (`YYYY-MM-DD`, already an NZ-local
 * calendar date per plan §6) and never re-derives the calendar date from a
 * UTC instant with a different offset assumption — it builds a UTC midnight
 * instant from the date's own year/month/day and renders it in
 * `Pacific/Auckland`. Because the NZ offset is always +12h or +13h (never
 * negative, never >=24h), that instant always falls on the *same* calendar
 * day in NZ local time, so this is safe year-round including across DST
 * transitions — it never needs to "guess and correct" the way
 * `sessionCutoff` does, because it only ever reads off calendar fields
 * (weekday/day/month/year), never a specific NZ clock time.
 */
import type { IsoDate, TimeOfDay, Weekday } from '@obc/shared';

const nzDateLabelFormatter = new Intl.DateTimeFormat('en-NZ', {
  timeZone: 'Pacific/Auckland',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** `2027-01-11` -> `"Mon 11 Jan 2027"`. */
export function formatDateNZ(date: IsoDate): string {
  const [year, month, day] = date.split('-').map(Number);
  const instant = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  const parts = nzDateLabelFormatter.formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')} ${get('year')}`;
}

/** `"13:00"` -> `"1:00pm"`; `"07:00"` -> `"7:00am"`. Falls back to the raw value if unparseable. */
export function formatTimeOfDay(time: TimeOfDay): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return time;
  const hour24 = Number(match[1]);
  const minute = match[2];
  if (Number.isNaN(hour24) || hour24 < 0 || hour24 > 23) return time;
  const period = hour24 < 12 ? 'am' : 'pm';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minute}${period}`;
}

const SHORT_WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
};

/** Short tab label for a `Weekday`, e.g. `"monday"` -> `"Mon"`. */
export function shortWeekdayLabel(weekday: Weekday): string {
  return SHORT_WEEKDAY_LABELS[weekday];
}

const nzDateTimeLabelFormatter = new Intl.DateTimeFormat('en-NZ', {
  timeZone: 'Pacific/Auckland',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** Formats a full ISO instant (e.g. an invite's `expiresAt`) as an NZ-local date + time. */
export function formatDateTimeNZ(iso: string): string {
  return nzDateTimeLabelFormatter.format(new Date(iso));
}

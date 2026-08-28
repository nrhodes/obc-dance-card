/**
 * NZ-local date/time helpers (plan §6). All programme date logic must go
 * through these — never `new Date().toISOString().slice(0, 10)`, which gives
 * the UTC calendar date, not the NZ one. Implemented with `Intl.DateTimeFormat`
 * against the IANA `Pacific/Auckland` zone; no date library needed.
 */

import type { IsoDate, TimeOfDay } from './primitives.js';

const NZ_TIME_ZONE = 'Pacific/Auckland';

// en-CA formats as YYYY-MM-DD, which is exactly the `IsoDate` shape we store.
const nzDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: NZ_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const nzDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: NZ_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Today's calendar date in `Pacific/Auckland`, as `YYYY-MM-DD`. */
export function todayNZ(now: Date = new Date()): IsoDate {
  return nzDateFormatter.format(now);
}

/** True when `date` (an NZ-local `YYYY-MM-DD`) is strictly before today (NZ). */
export function isPastNZ(date: IsoDate, now: Date = new Date()): boolean {
  return date < todayNZ(now);
}

/** The Pacific/Auckland UTC offset, in minutes, in effect at `instant`. */
function nzOffsetMinutesAt(instant: Date): number {
  const parts = nzDateTimeFormatter.formatToParts(instant);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const asUtcMillis = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return Math.round((asUtcMillis - instant.getTime()) / 60_000);
}

/**
 * The UTC instant at which a session starting at `startTime` (24h, `HH:MM`)
 * on NZ-local `date` begins — i.e. the moment the session "locks" (§6/I7).
 */
export function sessionCutoff(date: IsoDate, startTime: TimeOfDay): Date {
  const dateParts = date.split('-').map(Number);
  const timeParts = startTime.split(':').map(Number);
  const [year, month, day] = [dateParts[0] ?? 1970, dateParts[1] ?? 1, dateParts[2] ?? 1];
  const [hour, minute] = [timeParts[0] ?? 0, timeParts[1] ?? 0];

  // First guess: treat the NZ wall-clock time as if it were UTC, then find
  // the offset in effect near that instant and subtract it. Re-derive the
  // offset from the corrected instant once more to handle the (rare) case
  // where the guess landed on the other side of a DST transition.
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offset1 = nzOffsetMinutesAt(guess);
  const instant1 = new Date(guess.getTime() - offset1 * 60_000);
  const offset2 = nzOffsetMinutesAt(instant1);
  if (offset2 === offset1) return instant1;
  return new Date(guess.getTime() - offset2 * 60_000);
}

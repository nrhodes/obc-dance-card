/**
 * Pure RFC 5545 (`text/calendar`) building blocks for the iCal subscription
 * feed (plan §21 B1). No Firestore/Firebase imports here — everything in
 * this file is a plain string transform so it can be unit-tested heavily
 * without the emulator. `firebase/functions/src/ical/feed.ts` is the only
 * caller.
 */

const MAX_LINE_OCTETS = 75;

/**
 * Escapes TEXT-valued property content per RFC 5545 §3.3.11: backslash,
 * semicolon, comma, and newline. Order matters — backslash must be escaped
 * first, or the escapes just inserted would themselves be re-escaped.
 */
export function escapeIcsText(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Folds one unfolded content line to RFC 5545 §3.1's 75-octet limit: after
 * every 75 octets, insert CRLF followed by a single leading space on the
 * continuation line (which itself then carries up to 74 more content
 * octets, since the leading space counts against its own line's budget).
 * Operates on Unicode codepoints (`Array.from`, not UTF-16 code units) so a
 * surrogate pair is never split across a fold, and measures each codepoint's
 * *UTF-8* byte length (`TextEncoder`) so the 75-octet budget is the one the
 * RFC actually means — never mid-sequence.
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const physicalLines: string[] = [];
  let current = '';
  let currentOctets = 0;
  let budget = MAX_LINE_OCTETS;

  for (const ch of Array.from(line)) {
    const chOctets = encoder.encode(ch).length;
    if (currentOctets + chOctets > budget) {
      physicalLines.push(current);
      current = '';
      currentOctets = 0;
      budget = MAX_LINE_OCTETS - 1; // continuation lines carry a leading space
    }
    current += ch;
    currentOctets += chOctets;
  }
  physicalLines.push(current);

  return physicalLines.map((l, i) => (i === 0 ? l : ` ${l}`)).join('\r\n');
}

/** `2027-01-12T13:00:00.000Z` -> `20270112T130000Z` (DTSTAMP/LAST-MODIFIED form). */
export function icsUtcDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/**
 * `date` (`YYYY-MM-DD`, already NZ-local per plan §6) + `time` (`HH:MM`
 * NZ-local wall clock), plus an optional offset in minutes, formatted as the
 * local `YYYYMMDDTHHMMSS` form `DTSTART;TZID=Pacific/Auckland:` expects.
 * Deliberately plain calendar-field arithmetic via `Date.UTC` used only as a
 * component calculator (never as a real UTC instant) — exactly
 * `shared/src/time.ts#addDaysNZ`'s reasoning: the inputs are already
 * NZ-local, so no timezone conversion is needed or wanted; the static
 * VTIMEZONE block (`buildCalendar`) is what makes this a genuine
 * Pacific/Auckland local time, DST included.
 */
export function localDateTime(date: string, time: string, addMinutes = 0): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0));
  dt.setUTCMinutes(dt.getUTCMinutes() + addMinutes);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00`;
}

export interface IcsEvent {
  /** Already the full `{entryId}@obc-dance-card` form. */
  uid: string;
  summary: string;
  location?: string;
  status: 'CONFIRMED' | 'TENTATIVE';
  /** NZ-local session date, `YYYY-MM-DD`. */
  date: string;
  /** NZ-local session start, `HH:MM`. */
  startTime: string;
  durationMinutes: number;
  /** `entry.updatedAt` — used for both DTSTAMP and LAST-MODIFIED. */
  dtstamp: string;
  lastModified: string;
}

export interface BuildCalendarOptions {
  prodId: string;
}

/**
 * The exact, hand-verified NZ DST rules (plan §21 B1) — deliberately static
 * rather than derived at runtime.
 */
const VTIMEZONE_BLOCK = [
  'BEGIN:VTIMEZONE',
  'TZID:Pacific/Auckland',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+1200',
  'TZOFFSETTO:+1300',
  'TZNAME:NZDT',
  'DTSTART:19700927T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=9;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+1300',
  'TZOFFSETTO:+1200',
  'TZNAME:NZST',
  'DTSTART:19700405T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
].join('\r\n');

/**
 * Renders a full `VCALENDAR` document, CRLF-joined and line-folded, for one
 * member's feed. `events` should already be filtered/ordered by the caller
 * (`ical/feed.ts`) — this function has no opinion on which entries qualify.
 */
export function buildCalendar(events: IcsEvent[], opts: BuildCalendarOptions): string {
  const header = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${opts.prodId}`,
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Orewa Bridge Club',
    'X-WR-TIMEZONE:Pacific/Auckland',
  ].map(foldIcsLine);

  const lines: string[] = [...header, VTIMEZONE_BLOCK];

  for (const ev of events) {
    const dtstart = localDateTime(ev.date, ev.startTime);
    const dtend = localDateTime(ev.date, ev.startTime, ev.durationMinutes);
    const eventLines = [
      'BEGIN:VEVENT',
      `UID:${escapeIcsText(ev.uid)}`,
      `DTSTAMP:${icsUtcDateTime(ev.dtstamp)}`,
      `DTSTART;TZID=Pacific/Auckland:${dtstart}`,
      `DTEND;TZID=Pacific/Auckland:${dtend}`,
      `SUMMARY:${escapeIcsText(ev.summary)}`,
      ...(ev.location ? [`LOCATION:${escapeIcsText(ev.location)}`] : []),
      `STATUS:${ev.status}`,
      `LAST-MODIFIED:${icsUtcDateTime(ev.lastModified)}`,
      'END:VEVENT',
    ];
    lines.push(...eventLines.map(foldIcsLine));
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

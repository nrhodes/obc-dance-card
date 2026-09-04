import { describe, expect, it } from 'vitest';
import { buildCalendar, escapeIcsText, foldIcsLine, icsUtcDateTime, localDateTime, type IcsEvent } from './ics.js';

describe('escapeIcsText', () => {
  it('escapes backslash, semicolon, comma, and newline per RFC 5545 §3.3.11', () => {
    const input = 'Marion Taylor; Pairs, session\\notes\nsecond line';
    expect(escapeIcsText(input)).toBe('Marion Taylor\\; Pairs\\, session\\\\notes\\nsecond line');
  });

  it('escapes a name containing every special character at once', () => {
    expect(escapeIcsText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne');
  });

  it('leaves plain text untouched', () => {
    expect(escapeIcsText('Jane Smith')).toBe('Jane Smith');
  });
});

describe('foldIcsLine', () => {
  it('does not fold a short line', () => {
    const line = 'SUMMARY:Marion Taylor Pairs';
    expect(foldIcsLine(line)).toBe(line);
  });

  it('folds a line over 75 octets, with a single leading space on each continuation', () => {
    const line = `SUMMARY:${'x'.repeat(120)}`;
    const folded = foldIcsLine(line);
    const physical = folded.split('\r\n');
    expect(physical.length).toBeGreaterThan(1);
    expect(physical[0]!.length).toBeLessThanOrEqual(75);
    for (const cont of physical.slice(1)) {
      expect(cont.startsWith(' ')).toBe(true);
      expect(cont.length).toBeLessThanOrEqual(75);
    }
    // Unfolding (drop the CRLF + single leading space) reconstructs the original.
    expect(physical[0] + physical.slice(1).map((l) => l.slice(1)).join('')).toBe(line);
  });

  it('folds a >75-octet summary containing multibyte characters without splitting a UTF-8 sequence', () => {
    // Each 'é' is 2 UTF-8 octets; repeated well past the 75-octet budget so
    // at least one fold must land between codepoints, never inside one.
    const multibyte = 'é'.repeat(60);
    const line = `SUMMARY:Café session ${multibyte} with José`;
    const folded = foldIcsLine(line);
    const physical = folded.split('\r\n');
    expect(physical.length).toBeGreaterThan(1);

    const encoder = new TextEncoder();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (const [i, phys] of physical.entries()) {
      const content = i === 0 ? phys : phys.slice(1);
      // Throws if `content` ends mid-UTF-8-sequence — the property under test.
      expect(() => decoder.decode(encoder.encode(content))).not.toThrow();
    }

    // Unfolding reconstructs the original string exactly.
    const unfolded = physical[0] + physical.slice(1).map((l) => l.slice(1)).join('');
    expect(unfolded).toBe(line);
  });
});

describe('icsUtcDateTime', () => {
  it('formats an ISO instant as the ICS UTC basic form', () => {
    expect(icsUtcDateTime('2027-01-12T00:30:05.000Z')).toBe('20270112T003005Z');
  });
});

describe('localDateTime', () => {
  it('formats an NZ-local date/time as YYYYMMDDTHHMMSS with no offset', () => {
    expect(localDateTime('2027-01-12', '13:00')).toBe('20270112T130000');
  });

  it('adds minutes and rolls over into the next day when needed', () => {
    expect(localDateTime('2027-01-12', '13:00', 180)).toBe('20270112T160000');
    expect(localDateTime('2027-01-12', '23:00', 180)).toBe('20270113T020000');
  });
});

const PROD_ID = '-//Orewa Bridge Club//OBC Dance Card//EN';

describe('buildCalendar', () => {
  it('renders the exact static VTIMEZONE block and VCALENDAR wrapper', () => {
    const ics = buildCalendar([], { prodId: PROD_ID });
    expect(ics).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        `PRODID:${PROD_ID}`,
        'CALSCALE:GREGORIAN',
        'X-WR-CALNAME:Orewa Bridge Club',
        'X-WR-TIMEZONE:Pacific/Auckland',
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
        'END:VCALENDAR',
      ].join('\r\n') + '\r\n',
    );
  });

  it('renders a small fixture (one confirmed, one looking-for-partner) exactly', () => {
    const events: IcsEvent[] = [
      {
        uid: 'sess1_mem1@obc-dance-card',
        summary: 'Marion Taylor Pairs with Jane Smith',
        location: 'Orewa Bridge Club',
        status: 'CONFIRMED',
        date: '2027-01-12',
        startTime: '13:00',
        durationMinutes: 180,
        dtstamp: '2027-01-01T00:00:00.000Z',
        lastModified: '2027-01-01T00:00:00.000Z',
      },
      {
        uid: 'sess2_mem1@obc-dance-card',
        summary: 'Tuesday Juniors (looking for a partner)',
        location: 'Orewa Bridge Club',
        status: 'TENTATIVE',
        date: '2027-01-19',
        startTime: '19:00',
        durationMinutes: 180,
        dtstamp: '2027-01-02T03:04:05.000Z',
        lastModified: '2027-01-02T03:04:05.000Z',
      },
    ];

    const ics = buildCalendar(events, { prodId: PROD_ID });
    const eventBlocks = ics.split('BEGIN:VEVENT').slice(1);
    expect(eventBlocks).toHaveLength(2);

    expect(ics).toContain('BEGIN:VEVENT\r\nUID:sess1_mem1@obc-dance-card');
    expect(ics).toContain('DTSTART;TZID=Pacific/Auckland:20270112T130000');
    expect(ics).toContain('DTEND;TZID=Pacific/Auckland:20270112T160000');
    expect(ics).toContain('SUMMARY:Marion Taylor Pairs with Jane Smith');
    expect(ics).toContain('LOCATION:Orewa Bridge Club');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).toContain('DTSTAMP:20270101T000000Z');
    expect(ics).toContain('LAST-MODIFIED:20270101T000000Z');
    expect(ics).toContain('END:VEVENT');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('maps a looking_for_partner/available-style event to STATUS:TENTATIVE', () => {
    const event: IcsEvent = {
      uid: 'sess3_mem1@obc-dance-card',
      summary: 'Thursday Bridge (available)',
      status: 'TENTATIVE',
      date: '2027-02-04',
      startTime: '19:00',
      durationMinutes: 180,
      dtstamp: '2027-02-01T00:00:00.000Z',
      lastModified: '2027-02-01T00:00:00.000Z',
    };
    const ics = buildCalendar([event], { prodId: PROD_ID });
    expect(ics).toContain('STATUS:TENTATIVE');
    expect(ics).not.toContain('STATUS:CONFIRMED');
  });

  it('escapes and folds SUMMARY text that needs both', () => {
    const longName = `Marion Taylor Pairs with ${'A'.repeat(80)}; special, guest`;
    const event: IcsEvent = {
      uid: 'sess4_mem1@obc-dance-card',
      summary: longName,
      status: 'CONFIRMED',
      date: '2027-01-12',
      startTime: '13:00',
      durationMinutes: 180,
      dtstamp: '2027-01-01T00:00:00.000Z',
      lastModified: '2027-01-01T00:00:00.000Z',
    };
    const ics = buildCalendar([event], { prodId: PROD_ID });
    expect(ics).toContain('\\;');
    expect(ics).toContain('\\,');
    // The folded SUMMARY spans more than one physical line.
    const summaryStart = ics.indexOf('SUMMARY:');
    const nextField = ics.indexOf('\r\nLOCATION', summaryStart);
    const summaryBlock = ics.slice(summaryStart, nextField === -1 ? undefined : nextField);
    expect(summaryBlock.split('\r\n ').length).toBeGreaterThan(1);
  });
});

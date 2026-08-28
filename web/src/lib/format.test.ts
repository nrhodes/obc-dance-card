import { describe, expect, it } from 'vitest';
import { formatDateNZ, formatTimeOfDay, shortWeekdayLabel } from './format';

describe('formatDateNZ', () => {
  it('formats an NZST date (no comma, short weekday/month)', () => {
    expect(formatDateNZ('2027-01-11')).toBe('Mon 11 Jan 2027');
  });

  it('formats a date on the other side of the year', () => {
    expect(formatDateNZ('2027-12-25')).toBe('Sat 25 Dec 2027');
  });

  it('formats dates either side of a DST transition without shifting a day', () => {
    // NZDT ends early April, NZST ends late September (2027).
    expect(formatDateNZ('2027-04-05')).toBe('Mon 5 Apr 2027');
    // en-NZ's ICU short-month form for September is "Sept", not "Sep".
    expect(formatDateNZ('2027-09-27')).toBe('Mon 27 Sept 2027');
  });

  it('pads no leading zero on the day', () => {
    expect(formatDateNZ('2027-02-01')).toBe('Mon 1 Feb 2027');
  });
});

describe('formatTimeOfDay', () => {
  it('formats a 24h afternoon time as 12h pm', () => {
    expect(formatTimeOfDay('13:00')).toBe('1:00pm');
  });

  it('formats a 24h morning time as 12h am', () => {
    expect(formatTimeOfDay('07:00')).toBe('7:00am');
  });

  it('formats midday and midnight correctly', () => {
    expect(formatTimeOfDay('12:00')).toBe('12:00pm');
    expect(formatTimeOfDay('00:00')).toBe('12:00am');
  });

  it('falls back to the raw value when unparseable', () => {
    expect(formatTimeOfDay('not-a-time')).toBe('not-a-time');
  });
});

describe('shortWeekdayLabel', () => {
  it('maps every weekday to its 3-letter label', () => {
    expect(shortWeekdayLabel('monday')).toBe('Mon');
    expect(shortWeekdayLabel('tuesday')).toBe('Tue');
    expect(shortWeekdayLabel('wednesday')).toBe('Wed');
    expect(shortWeekdayLabel('thursday')).toBe('Thu');
    expect(shortWeekdayLabel('friday')).toBe('Fri');
  });
});

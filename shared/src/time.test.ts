import { describe, expect, it } from 'vitest';
import { isPastNZ, sessionCutoff, todayNZ } from './time.js';

describe('todayNZ', () => {
  it('rolls over to the NZ calendar date, not the UTC one', () => {
    // 2027-01-11T11:30:00Z is 00:30 on 2027-01-12 in NZDT (UTC+13).
    expect(todayNZ(new Date('2027-01-11T11:30:00Z'))).toBe('2027-01-12');
  });

  it('is stable either side of the April DST fall-back (NZDT -> NZST)', () => {
    // NZ clocks go back at 2027-04-04 03:00 NZDT -> 02:00 NZST, i.e. at
    // 2027-04-03T14:00:00Z. Just before and just after, the NZ calendar date
    // is the same (2027-04-04) even though the UTC offset changes.
    const justBefore = new Date('2027-04-03T13:00:00Z'); // 2027-04-04T02:00 NZDT
    const justAfter = new Date('2027-04-03T15:00:00Z'); // 2027-04-04T03:00 NZST
    expect(todayNZ(justBefore)).toBe('2027-04-04');
    expect(todayNZ(justAfter)).toBe('2027-04-04');
  });

  it('is stable either side of the September DST spring-forward (NZST -> NZDT)', () => {
    // NZ clocks jump forward at 2027-09-26 02:00 NZST -> 03:00 NZDT, i.e. at
    // 2027-09-25T14:00:00Z. The NZ calendar date stays 2027-09-26 across it.
    const justBefore = new Date('2027-09-25T13:00:00Z'); // 2027-09-26T01:00 NZST
    const justAfter = new Date('2027-09-25T15:00:00Z'); // 2027-09-26T04:00 NZDT
    expect(todayNZ(justBefore)).toBe('2027-09-26');
    expect(todayNZ(justAfter)).toBe('2027-09-26');
  });

  it('defaults to the current instant when called with no argument', () => {
    expect(todayNZ()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('isPastNZ', () => {
  it('is true for a date strictly before today', () => {
    const now = new Date('2027-06-15T00:00:00Z');
    expect(isPastNZ('2027-06-01', now)).toBe(true);
  });

  it('is false for today and future dates', () => {
    const now = new Date('2027-01-11T11:30:00Z'); // 2027-01-12 in NZ
    expect(isPastNZ('2027-01-12', now)).toBe(false);
    expect(isPastNZ('2027-01-13', now)).toBe(false);
  });
});

describe('sessionCutoff', () => {
  it('produces the correct UTC instant in NZST (winter)', () => {
    // 2027-07-12 13:00 NZST (UTC+12) => 2027-07-12T01:00:00Z
    const cutoff = sessionCutoff('2027-07-12', '13:00');
    expect(cutoff.toISOString()).toBe('2027-07-12T01:00:00.000Z');
  });

  it('produces the correct UTC instant in NZDT (summer)', () => {
    // 2027-01-12 13:00 NZDT (UTC+13) => 2027-01-12T00:00:00Z
    const cutoff = sessionCutoff('2027-01-12', '13:00');
    expect(cutoff.toISOString()).toBe('2027-01-12T00:00:00.000Z');
  });

  it('round-trips back to the same NZ calendar date via todayNZ', () => {
    const cutoff = sessionCutoff('2027-04-04', '13:00');
    expect(todayNZ(cutoff)).toBe('2027-04-04');
  });
});

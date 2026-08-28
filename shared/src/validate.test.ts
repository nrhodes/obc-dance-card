import { describe, expect, it } from 'vitest';
import {
  assertIsoDate,
  isIsoDate,
  normaliseEmail,
  parseBooleanCell,
  parseDateList,
  parseGrade,
  parseOptionalInt,
  parseWeekday,
} from './validate.js';

describe('parseBooleanCell', () => {
  it.each([
    ['yes', true],
    ['Y', true],
    ['TRUE', true],
    ['1', true],
    ['no', false],
    ['', false],
    ['0', false],
  ])('parses %j as %j', (input, expected) => {
    expect(parseBooleanCell(input, 'f')).toBe(expected);
  });

  it('throws on nonsense', () => {
    expect(() => parseBooleanCell('maybe', 'allowSubstitute')).toThrow(/allowSubstitute/);
  });
});

describe('parseGrade', () => {
  it('matches case-insensitively', () => {
    expect(parseGrade('open')).toBe('Open');
    expect(parseGrade('INTERMEDIATE')).toBe('Intermediate');
  });
  it('falls back to Unknown', () => {
    expect(parseGrade('')).toBe('Unknown');
    expect(parseGrade('senior')).toBe('Unknown');
  });
});

describe('date helpers', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2027-01-12')).toBe(true);
    expect(isIsoDate('2027-13-01')).toBe(false);
    expect(isIsoDate('2027-02-30')).toBe(false);
    expect(isIsoDate('12/01/2027')).toBe(false);
  });
  it('assertIsoDate throws with the field name', () => {
    expect(() => assertIsoDate('nope', 'session.date')).toThrow(/session\.date/);
  });
  it('parses, de-dupes and sorts a date list', () => {
    expect(parseDateList('2027-01-26; 2027-01-12 ;2027-01-12,2027-01-19')).toEqual([
      '2027-01-12',
      '2027-01-19',
      '2027-01-26',
    ]);
  });
  it('rejects an empty list', () => {
    expect(() => parseDateList('  ')).toThrow(/at least one date/);
  });
});

describe('parseWeekday', () => {
  it('normalises case', () => {
    expect(parseWeekday('Monday')).toBe('monday');
  });
  it('throws on an unknown day', () => {
    expect(() => parseWeekday('Saturday')).toThrow(/weekday/);
  });
});

describe('parseOptionalInt', () => {
  it('returns null for blank', () => {
    expect(parseOptionalInt('', 'bestOfN')).toBeNull();
  });
  it('parses integers', () => {
    expect(parseOptionalInt('5', 'bestOfN')).toBe(5);
  });
  it('rejects negatives and decimals', () => {
    expect(() => parseOptionalInt('-1', 'bestOfN')).toThrow();
    expect(() => parseOptionalInt('2.5', 'bestOfN')).toThrow();
  });
});

describe('normaliseEmail', () => {
  it('trims and lower-cases', () => {
    expect(normaliseEmail('  Jane.DOE@Example.COM ')).toBe('jane.doe@example.com');
  });
});

// The pairing/team invariant checks (I1–I6, I9) now live in `pairing.ts` and
// are covered by `pairing.test.ts`.

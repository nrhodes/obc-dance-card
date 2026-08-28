import { describe, expect, it } from 'vitest';
import { assignSeriesIds, sessionIdForSeries, sessionIdForSingle, slugify } from './programmeIds.js';

describe('slugify', () => {
  it('lower-cases, collapses non-alphanumerics, and trims', () => {
    expect(slugify('Marion Taylor Pairs')).toBe('marion-taylor-pairs');
    expect(slugify("Martin Gillam Memorial Mon Champ Pairs")).toBe('martin-gillam-memorial-mon-champ-pairs');
    expect(slugify('  --Weird!!  Name__ ')).toBe('weird-name');
  });
});

describe('assignSeriesIds', () => {
  it('builds weekday-slug ids in file order', () => {
    const ids = assignSeriesIds([
      { weekday: 'monday', name: 'Marion Taylor Pairs' },
      { weekday: 'monday', name: 'Campbell Cave Pairs' },
      { weekday: 'tuesday', name: 'February Pairs' },
    ]);
    expect(ids).toEqual(['monday-marion-taylor-pairs', 'monday-campbell-cave-pairs', 'tuesday-february-pairs']);
  });

  it('disambiguates two series on the same weekday with an identical slug', () => {
    const ids = assignSeriesIds([
      { weekday: 'monday', name: 'Pairs' },
      { weekday: 'monday', name: 'Pairs' },
      { weekday: 'monday', name: 'Pairs' },
    ]);
    expect(ids).toEqual(['monday-pairs', 'monday-pairs-2', 'monday-pairs-3']);
  });

  it('does not disambiguate identical slugs on different weekdays', () => {
    const ids = assignSeriesIds([
      { weekday: 'monday', name: 'Pairs' },
      { weekday: 'tuesday', name: 'Pairs' },
    ]);
    expect(ids).toEqual(['monday-pairs', 'tuesday-pairs']);
  });
});

describe('sessionIdForSeries / sessionIdForSingle', () => {
  it('composes the deterministic session ids from plan §5.4', () => {
    expect(sessionIdForSeries('monday-marion-taylor-pairs', '2027-01-11')).toBe(
      'monday-marion-taylor-pairs-2027-01-11',
    );
    expect(sessionIdForSingle(2027, '2027-01-04', 'monday')).toBe('2027-2027-01-04-monday');
  });
});

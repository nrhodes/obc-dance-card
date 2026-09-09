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

  it('two series that collide on slug still get distinct session ids once run through the deduped seriesId (not the raw slug)', () => {
    // This is the id-generation collision case: assignSeriesIds already
    // disambiguates "monday-pairs" -> "monday-pairs-2" for the second row,
    // and runProgrammeImport must feed sessionIdForSeries the *deduped* id
    // (seriesIds[i]), never the raw `${weekday}-${slugify(name)}` base --
    // otherwise two distinct series meeting on the same date would produce
    // identical session ids and one would silently overwrite the other.
    const rows = [
      { weekday: 'monday' as const, name: 'Pairs' },
      { weekday: 'monday' as const, name: 'Pairs' },
    ];
    const ids = assignSeriesIds(rows);
    expect(ids).toEqual(['monday-pairs', 'monday-pairs-2']);

    const date = '2027-01-11';
    const sessionIds = ids.map((id) => sessionIdForSeries(id, date));
    expect(sessionIds).toEqual(['monday-pairs-2027-01-11', 'monday-pairs-2-2027-01-11']);
    expect(new Set(sessionIds).size).toBe(sessionIds.length);
  });

  it('many series sharing a slug on the same weekday all produce pairwise-distinct session ids across every one of their dates', () => {
    // Regression guard for the id-collision hypothesis in general, not just
    // the n=2 case: N colliding series x M shared dates must yield N*M
    // distinct session ids.
    const rows = Array.from({ length: 5 }, () => ({ weekday: 'monday' as const, name: 'Pairs' }));
    const ids = assignSeriesIds(rows);
    expect(ids).toEqual(['monday-pairs', 'monday-pairs-2', 'monday-pairs-3', 'monday-pairs-4', 'monday-pairs-5']);

    const dates = ['2027-01-04', '2027-01-11', '2027-01-18'];
    const allSessionIds = ids.flatMap((id) => dates.map((date) => sessionIdForSeries(id, date)));
    expect(new Set(allSessionIds).size).toBe(allSessionIds.length);
  });
});

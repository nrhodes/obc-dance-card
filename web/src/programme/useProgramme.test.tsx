import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Programme, Series, Session, WeekdayProgramme } from '@obc/shared';
import { ProgrammeContext, type ProgrammeContextValue, type ProgrammeYearData } from './ProgrammeContext';
import { useProgramme } from './useProgramme';

function weekday(year: number): WeekdayProgramme {
  return {
    id: 'monday',
    weekday: 'monday',
    label: `Monday ${year}`,
    startTime: '13:00',
    seatedByTime: '12:45',
    createdAt: '',
    updatedAt: '',
  };
}

function series(year: number): Series {
  return {
    id: 'monday-pairs',
    weekday: 'monday',
    name: `Pairs ${year}`,
    scoring: 'Scr',
    format: 'Pairs',
    bestOf: null,
    allowSubstitute: true,
    order: 0,
    sessionIds: [],
    teamMin: 4,
    teamMax: 6,
    createdAt: '',
    updatedAt: '',
  };
}

function session(year: number): Session {
  return {
    id: `monday-pairs-${year}-01-11`,
    date: `${year}-01-11`,
    weekday: 'monday',
    seriesId: 'monday-pairs',
    kind: 'series',
    title: `Pairs ${year}`,
    partnerRequired: true,
    createdAt: '',
    updatedAt: '',
  };
}

function programmeDoc(year: number): Programme {
  return { id: String(year), year, status: 'published', createdAt: '', updatedAt: '' };
}

function makeYearData(year: number): ProgrammeYearData {
  return { year, programme: programmeDoc(year), weekdays: [weekday(year)], series: [series(year)], sessions: [session(year)] };
}

/** Two loaded published years, newest first — mirrors `ProgrammeProvider`'s merged shape. */
function twoYearContext(overrides: Partial<ProgrammeContextValue> = {}): ProgrammeContextValue {
  const byYear = [makeYearData(2027), makeYearData(2026)];
  return {
    loading: false,
    error: null,
    years: [2027, 2026],
    byYear,
    weekdays: byYear.flatMap((yd) => yd.weekdays.map((w) => ({ ...w, year: yd.year }))),
    series: byYear.flatMap((yd) => yd.series.map((s) => ({ ...s, year: yd.year }))),
    sessions: byYear.flatMap((yd) => yd.sessions.map((s) => ({ ...s, year: yd.year }))),
    year: 2027,
    programme: programmeDoc(2027),
    ...overrides,
  };
}

function wrapperFor(ctx: ProgrammeContextValue) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ProgrammeContext.Provider value={ctx}>{children}</ProgrammeContext.Provider>;
  };
}

describe('useProgramme', () => {
  it('throws when used outside a ProgrammeProvider', () => {
    expect(() => renderHook(() => useProgramme())).toThrow('useProgramme must be used within a ProgrammeProvider');
  });

  it('with no year argument, returns the merged multi-year view unchanged', () => {
    const ctx = twoYearContext();
    const { result } = renderHook(() => useProgramme(), { wrapper: wrapperFor(ctx) });
    expect(result.current.years).toEqual([2027, 2026]);
    expect(result.current.sessions).toHaveLength(2);
    expect(result.current.year).toBe(2027);
  });

  it('with a loaded year, returns just that year\'s slice, still year-tagged', () => {
    const ctx = twoYearContext();
    const { result } = renderHook(() => useProgramme(2026), { wrapper: wrapperFor(ctx) });

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0]!.id).toBe('monday-pairs-2026-01-11');
    expect(result.current.sessions[0]!.year).toBe(2026);
    expect(result.current.series).toHaveLength(1);
    expect(result.current.series[0]!.name).toBe('Pairs 2026');
    expect(result.current.weekdays).toHaveLength(1);
    expect(result.current.weekdays[0]!.label).toBe('Monday 2026');
    expect(result.current.year).toBe(2026);
    expect(result.current.programme?.year).toBe(2026);

    // `years`/`loading`/`error` stay truthful to the underlying subscription, not narrowed to the requested year.
    expect(result.current.years).toEqual([2027, 2026]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('with an unloaded year, returns empty subcollection arrays rather than an error', () => {
    const ctx = twoYearContext();
    const { result } = renderHook(() => useProgramme(2099), { wrapper: wrapperFor(ctx) });

    expect(result.current.sessions).toEqual([]);
    expect(result.current.series).toEqual([]);
    expect(result.current.weekdays).toEqual([]);
    expect(result.current.programme).toBeNull();
    expect(result.current.year).toBe(2099);
    expect(result.current.error).toBeNull();
    expect(result.current.years).toEqual([2027, 2026]);
  });
});

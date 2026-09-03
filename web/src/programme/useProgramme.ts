import { useContext, useMemo } from 'react';
import { ProgrammeContext, type ProgrammeContextValue } from './ProgrammeContext';

/**
 * Reads the shared programme subscription from `ProgrammeProvider` (plan
 * §21 B3: multiple published years can be loaded at once — current, next,
 * and one back).
 *
 * - `useProgramme()` — the merged, chronological, year-tagged view across
 *   every loaded published year. This is what the programme browser and "My
 *   Dance Card" want.
 * - `useProgramme(year)` — that one year's slice, still year-tagged, so a
 *   caller like the session page (`/session/:year/:sessionId`) can pin
 *   itself to the year in its route. If `year` isn't among the currently
 *   loaded published years, the subcollection arrays come back empty (never
 *   an error) and the caller's own "not found" handling applies — `years`,
 *   `loading`, and `error` stay truthful to the underlying subscriptions
 *   either way.
 */
export function useProgramme(year?: number): ProgrammeContextValue {
  const ctx = useContext(ProgrammeContext);
  if (!ctx) {
    throw new Error('useProgramme must be used within a ProgrammeProvider');
  }
  return useMemo(() => {
    if (year == null) return ctx;
    const yearData = ctx.byYear.find((y) => y.year === year);
    return {
      ...ctx,
      weekdays: yearData ? yearData.weekdays.map((w) => ({ ...w, year })) : [],
      series: yearData ? yearData.series.map((s) => ({ ...s, year })) : [],
      sessions: yearData ? yearData.sessions.map((s) => ({ ...s, year })) : [],
      year,
      programme: yearData?.programme ?? null,
    };
  }, [ctx, year]);
}

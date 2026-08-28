import { useContext } from 'react';
import { ProgrammeContext, type ProgrammeContextValue } from './ProgrammeContext';

/**
 * Reads the shared programme subscription from `ProgrammeProvider`.
 *
 * `year` is accepted (per the task spec's `useProgramme(year)` signature) so
 * a screen reading a specific year — e.g. the session page's `/session/:year/:sessionId`
 * route — can state which year it expects; the provider only ever tracks the
 * single *currently published* year (there is exactly one "current
 * programme" at a time, plan §5.4), so when `year` doesn't match nothing in
 * `sessions`/`series`/`weekdays` will match it either and the caller's own
 * "not found" handling covers that case naturally — no separate subscription
 * is needed for this phase's read-only screens.
 */
export function useProgramme(year?: number): ProgrammeContextValue {
  const ctx = useContext(ProgrammeContext);
  if (!ctx) {
    throw new Error('useProgramme must be used within a ProgrammeProvider');
  }
  void year;
  return ctx;
}

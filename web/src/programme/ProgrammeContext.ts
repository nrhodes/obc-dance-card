/**
 * Shared "current programme" subscription (plan Phase 2b task: "Subscribe
 * with onSnapshot to weekdays, series, and sessions for that year. Put this
 * in a useProgramme(year) hook with a small context/provider so screens
 * share one subscription.").
 *
 * The "current programme year" is the latest `programmes/{year}` doc with
 * `status: 'published'` — members cannot read drafts at all (rules deny it),
 * so there is nothing to filter client-side. `ProgrammeProvider` mounts once
 * (inside the member-only part of the route tree) and does the single
 * `onSnapshot` query plus the three subcollection subscriptions for that
 * year; `useProgramme` is the read side every screen calls.
 */
import { createContext } from 'react';
import type { Programme, Series, Session, WeekdayProgramme } from '@obc/shared';

export interface ProgrammeContextValue {
  /** The current published programme's year, or null if none is published yet. */
  year: number | null;
  programme: Programme | null;
  weekdays: WeekdayProgramme[];
  series: Series[];
  sessions: Session[];
  /** True until the programme query *and* (if a year was found) its subcollections have loaded once. */
  loading: boolean;
}

export const ProgrammeContext = createContext<ProgrammeContextValue | undefined>(undefined);

/**
 * Shared "published programmes" subscription (plan Phase 2b task originally;
 * extended by plan §21 B3 "Hide past events by default + two-year horizon").
 *
 * There is no longer exactly one "current programme year" — the club
 * publishes next year's programme before the current year ends, and members
 * book across that boundary (plan §21 B3). `ProgrammeProvider` subscribes to
 * every `programmes/{year}` doc with `status: 'published'` (newest 3 years,
 * §21 B3: current + next + one back), plus each of those years' weekdays /
 * series / sessions subcollections, and merges them into one chronological,
 * year-tagged view. `useProgramme` is the read side every screen calls —
 * either the merged view (`useProgramme()`) or one year's slice
 * (`useProgramme(year)`).
 *
 * **ID collision warning** (plan §21 B3 context): `seriesId` is
 * `${weekday}-${slug(name)}` and weekday doc ids are the `Weekday` value —
 * both can collide across years (a series named the same thing two years
 * running, or simply "monday" existing in every year). Session ids embed
 * the date and are globally unique. Any lookup against the *merged*
 * `weekdays`/`series` arrays below must not assume a bare id is unique —
 * either qualify by `year`, or rely on the arrays being ordered
 * newest-year-first (see `ProgrammeProvider`) when "prefer the newest
 * year's doc" is the desired behaviour.
 */
import { createContext } from 'react';
import type { Programme, Series, Session, WeekdayProgramme } from '@obc/shared';

/** One published year's programme + its subcollections. */
export interface ProgrammeYearData {
  year: number;
  programme: Programme;
  weekdays: WeekdayProgramme[];
  series: Series[];
  sessions: Session[];
}

export interface ProgrammeContextValue {
  /** True until the programmes query *and* every loaded year's subcollections have loaded once. */
  loading: boolean;
  /** Set when a live subscription failed (e.g. a rules denial) — never conflated with "no programme yet". */
  error: { code: string } | null;
  /** Published years currently loaded, newest first. */
  years: number[];
  /** One entry per `years`, same (newest-first) order. */
  byYear: ProgrammeYearData[];
  /** Every loaded year's weekdays, each tagged with its year, newest year first. */
  weekdays: Array<WeekdayProgramme & { year: number }>;
  /** Every loaded year's series, each tagged with its year, newest year first. */
  series: Array<Series & { year: number }>;
  /** Every loaded year's sessions, each tagged with its year, newest year first. */
  sessions: Array<Session & { year: number }>;
  /** The newest published year, or null if none is published yet. Kept for headings/back-compat. */
  year: number | null;
  /** The newest published year's programme doc. */
  programme: Programme | null;
}

export const ProgrammeContext = createContext<ProgrammeContextValue | undefined>(undefined);

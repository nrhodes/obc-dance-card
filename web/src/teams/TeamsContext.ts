/**
 * Shared "teams" subscription (plan Phase 4c task, §5.9, §12A): every
 * non-disbanded team, club-scale (there is no size at which this club would
 * have enough concurrent Teams series to make a per-series subscription
 * worthwhile) — reused by the session page's Team panel and the Invites
 * screen's team-invite labels. Mirrors `MembersDirectoryContext`'s split.
 */
import { createContext } from 'react';
import type { Team } from '@obc/shared';

export interface TeamsContextValue {
  teams: Team[];
  loading: boolean;
  /** Every forming/active team for a series, in no particular order. */
  teamsForSeries: (seriesId: string) => Team[];
  /** The signed-in member's own team for a series, or null if they're not on one. */
  myTeamForSeries: (seriesId: string) => Team | null;
  /** A team by id, or undefined if it doesn't exist / isn't forming or active. */
  teamById: (teamId: string) => Team | undefined;
}

export const TeamsContext = createContext<TeamsContextValue | undefined>(undefined);

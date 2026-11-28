/**
 * The club the app is currently showing (plan §21 B14).
 *
 * Every club-owned Firestore read takes its paths from `useClub()` rather
 * than from a global, so that a screen re-subscribes when the club changes
 * and — from stage 4 — a merged screen can read several clubs side by side.
 *
 * The default context values are the one original club with nothing to
 * choose between, so components and tests work without a provider.
 */
import { createContext } from 'react';
import { DEFAULT_CLUB_ID, clubPaths, type ClubId, type ClubPaths } from '@obc/shared';

export const ClubContext = createContext<ClubPaths>(clubPaths(DEFAULT_CLUB_ID));

/** What the header needs to name the current club and offer the others. */
export interface ClubChoice {
  id: ClubId;
  /** The club's display name, or its id until the club record has loaded. */
  name: string;
}

export interface ClubsState {
  /** The clubs the signed-in person is an active member of. Empty when signed out. */
  clubs: ClubChoice[];
  currentClubId: ClubId;
  selectClub: (clubId: ClubId) => void;
}

export const ClubsContext = createContext<ClubsState>({
  clubs: [],
  currentClubId: DEFAULT_CLUB_ID,
  selectClub: () => {},
});

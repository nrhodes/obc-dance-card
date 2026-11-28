import { useContext } from 'react';
import type { ClubPaths } from '@obc/shared';
import { ClubContext, ClubsContext, type ClubsState } from './ClubContext';

/** Path builders for the current club's data; `useClub().clubId` is its id. */
export function useClub(): ClubPaths {
  return useContext(ClubContext);
}

/** The signed-in person's clubs, which one is showing, and how to switch. */
export function useClubs(): ClubsState {
  return useContext(ClubsContext);
}

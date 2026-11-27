import { useContext } from 'react';
import type { ClubPaths } from '@obc/shared';
import { ClubContext } from './ClubContext';

/** Path builders for the current club's data; `useClub().clubId` is its id. */
export function useClub(): ClubPaths {
  return useContext(ClubContext);
}

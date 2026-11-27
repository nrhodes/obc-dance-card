/**
 * Chooses the current club (plan §21 B14) and tells the API layer about it,
 * so club-scoped callables carry the same `clubId` the screens are reading.
 *
 * Stage 1a: always `DEFAULT_CLUB_ID`. Stage 3 resolves it from the signed-in
 * person's memberships; stage 4 adds the header switcher that changes it.
 */
import { useMemo, type ReactNode } from 'react';
import { DEFAULT_CLUB_ID, clubPaths } from '@obc/shared';
import { setCurrentClubId } from '../api';
import { ClubContext } from './ClubContext';

export function ClubProvider({ children }: { children: ReactNode }) {
  const clubId = DEFAULT_CLUB_ID;
  const cp = useMemo(() => {
    // Set while rendering, not in an effect: children may issue a callable
    // from their own effects, which run before a parent's.
    setCurrentClubId(clubId);
    return clubPaths(clubId);
  }, [clubId]);
  return <ClubContext.Provider value={cp}>{children}</ClubContext.Provider>;
}

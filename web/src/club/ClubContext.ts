/**
 * The club the app is currently showing (plan §21 B14).
 *
 * Every club-owned Firestore read takes its paths from `useClub()` rather
 * than from a global, so that a screen re-subscribes when the club changes
 * and — from stage 4 — a merged screen can read several clubs side by side.
 *
 * Stage 1a: there is one club, `DEFAULT_CLUB_ID`, and no way to choose
 * another. The default context value is that club, so components and tests
 * work without a provider.
 */
import { createContext } from 'react';
import { DEFAULT_CLUB_ID, clubPaths, type ClubPaths } from '@obc/shared';

export const ClubContext = createContext<ClubPaths>(clubPaths(DEFAULT_CLUB_ID));

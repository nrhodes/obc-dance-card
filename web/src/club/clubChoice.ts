/**
 * Which of a person's clubs to show, and remembering their last choice on
 * this device. Pure helpers, separate from `ClubProvider` so they can be
 * tested without Firebase.
 */
import { DEFAULT_CLUB_ID, type ClubId } from '@obc/shared';

const KEY_PREFIX = 'obc.currentClub.';

/**
 * The club to show: the person's remembered choice when they still belong to
 * it; otherwise the default club when they belong to that; otherwise their
 * first club. With no clubs at all (signed out, or not a member anywhere)
 * the default club stands in — nothing is readable in that state anyway.
 */
export function chooseClub(clubIds: readonly ClubId[], preferred: ClubId | null): ClubId {
  if (preferred && clubIds.includes(preferred)) return preferred;
  if (clubIds.includes(DEFAULT_CLUB_ID)) return DEFAULT_CLUB_ID;
  return clubIds[0] ?? DEFAULT_CLUB_ID;
}

export function readStoredClub(uid: string): ClubId | null {
  try {
    return window.localStorage.getItem(KEY_PREFIX + uid);
  } catch {
    return null; // storage blocked: the choice simply is not remembered
  }
}

export function storeClub(uid: string, clubId: ClubId): void {
  try {
    window.localStorage.setItem(KEY_PREFIX + uid, clubId);
  } catch {
    // storage blocked: the choice lasts for this page load only
  }
}

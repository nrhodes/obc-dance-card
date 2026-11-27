/**
 * Club resolution (plan §21 B14). Everything a club owns is addressed through
 * a `ClubPaths` (`clubPaths(clubId)`, `@obc/shared`); this module is where the
 * server decides WHICH club a request, a scheduled job or a person-level
 * lookup is about.
 *
 * Stage 1a/1b: exactly one club exists, `DEFAULT_CLUB_ID`. Stage 2 replaces
 * the constants below with lookups of `clubs/{clubId}` and of the person's
 * memberships (`users/{uid}.clubIds`) — callers do not change.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { DEFAULT_CLUB_ID, clubPaths, type ClubId, type ClubPaths, type Member } from '@obc/shared';
import { db } from './admin.js';

/**
 * The club a club-scoped callable acts in: its input's `clubId`, or the
 * default club while that field is still optional (until stage 1c).
 *
 * An unknown club is refused rather than ignored. During stage 1a the path
 * builders do not yet include the club, so quietly accepting another id
 * would run the request against the default club's data.
 */
export function clubOf(input: { clubId?: ClubId | undefined }): ClubPaths {
  const clubId = input.clubId ?? DEFAULT_CLUB_ID;
  if (clubId !== DEFAULT_CLUB_ID) {
    throw new HttpsError('not-found', 'Unknown club.');
  }
  return clubPaths(clubId);
}

/** Every club, for jobs that sweep all of them (reminders, digests, purge, integrity). */
export async function allClubs(): Promise<ClubPaths[]> {
  return [clubPaths(DEFAULT_CLUB_ID)];
}

/** The clubs a person may belong to — the candidates for a membership lookup by uid. */
export async function clubsOfPerson(_uid: string): Promise<ClubPaths[]> {
  return allClubs();
}

/** One club's membership record for a person, with the club it came from. */
export interface Membership {
  cp: ClubPaths;
  member: Member;
}

/** Every membership a person holds, active or not. */
export async function membershipsOf(uid: string): Promise<Membership[]> {
  const out: Membership[] = [];
  for (const cp of await clubsOfPerson(uid)) {
    const member = (await db.doc(cp.member(uid)).get()).data() as Member | undefined;
    if (member) out.push({ cp, member });
  }
  return out;
}

/** Only the ACTIVE memberships a person holds. Sign-in requires at least one. */
export async function activeMembershipsOf(uid: string): Promise<Membership[]> {
  return (await membershipsOf(uid)).filter((m) => m.member.active === true);
}

/**
 * Every person with an active membership somewhere, each listed once — for
 * jobs that are about people rather than clubs (the daily digest).
 */
export async function activePersonIds(): Promise<string[]> {
  const ids = new Set<string>();
  for (const cp of await allClubs()) {
    const snap = await db.collection(cp.members()).where('active', '==', true).get();
    for (const doc of snap.docs) ids.add(doc.id);
  }
  return [...ids];
}

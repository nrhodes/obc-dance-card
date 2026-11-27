/**
 * Club resolution (plan §21 B14). Everything a club owns is addressed through
 * a `ClubPaths` (`clubPaths(clubId)`, `@obc/shared`); this module is where the
 * server decides WHICH club a request, a scheduled job or a person-level
 * lookup is about.
 *
 * Stage 1: exactly one club exists, `DEFAULT_CLUB_ID`. Stage 2 replaces the
 * constants below with lookups of `clubs/{clubId}` — callers do not change.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  DEFAULT_CLUB_ID,
  NZ_TIME_ZONE,
  clubPaths,
  paths,
  type Club,
  type ClubId,
  type ClubPaths,
  type Member,
} from '@obc/shared';
import { db } from './admin.js';

/**
 * The club a club-scoped callable acts in: its input's `clubId`, or the
 * default club while that field is still optional (until stage 1c).
 *
 * An unknown club is refused here, before any read: only clubs that exist may
 * be named (stage 2 replaces this check with a lookup of `clubs/{clubId}`).
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

/**
 * The write that keeps `users/{uid}.clubIds` in step with a membership's
 * `active` flag (see `UserDoc`). A merge with `arrayUnion`/`arrayRemove`, so
 * it needs no prior read and is safe to queue in a batch or run inside a
 * transaction alongside the membership write it mirrors.
 *
 * EVERY code path that creates a membership or changes its `active` flag
 * must also write this — the rules gate notifications and `userPrivate` on
 * `clubIds` being non-empty.
 */
export function userClubsWrite(
  uid: string,
  clubId: ClubId,
  active: boolean,
): { path: string; data: FirebaseFirestore.DocumentData } {
  return {
    path: paths.user(uid),
    data: {
      id: uid,
      clubIds: active ? FieldValue.arrayUnion(clubId) : FieldValue.arrayRemove(clubId),
      updatedAt: new Date().toISOString(),
    },
  };
}

/** `userClubsWrite`, applied immediately. */
export async function setUserClubActive(uid: string, clubId: ClubId, active: boolean): Promise<void> {
  const w = userClubsWrite(uid, clubId, active);
  await db.doc(w.path).set(w.data, { merge: true });
}

/**
 * Whether the person is still an active member of some club other than
 * `exceptClubId` — asked when one membership is being deactivated, to decide
 * whether the Auth account itself should be disabled (plan §21 B14.3: only
 * when no active membership remains anywhere).
 */
export async function hasOtherActiveMembership(uid: string, exceptClubId: ClubId): Promise<boolean> {
  return (await activeMembershipsOf(uid)).some((m) => m.cp.clubId !== exceptClubId);
}

/** The record for the one club that exists, as the seed and the stage-1b migration write it. */
export function defaultClubRecord(now: string): Club {
  return {
    id: DEFAULT_CLUB_ID,
    name: 'Orewa Bridge Club',
    shortName: 'Orewa',
    timezone: NZ_TIME_ZONE,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

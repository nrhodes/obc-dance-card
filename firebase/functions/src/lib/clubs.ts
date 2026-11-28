/**
 * Club resolution (plan §21 B14). Everything a club owns is addressed through
 * a `ClubPaths` (`clubPaths(clubId)`, `@obc/shared`); this module is where the
 * server decides WHICH club a request, a scheduled job or a person-level
 * lookup is about.
 *
 * The registry of clubs is the `clubs` collection: a club exists when
 * `clubs/{clubId}` does, and takes part when its `status` is `'active'`.
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
 * How long a club record is trusted without re-reading it. Clubs are created
 * and suspended rarely, and every callable and every sign-in asks which exist,
 * so a short cache saves a read per request. Disabled against the emulator,
 * where tests create a club and use it in the next statement.
 */
const CLUB_CACHE_MS = process.env.FIRESTORE_EMULATOR_HOST ? 0 : 60_000;

let activeClubsCache: { at: number; ids: ClubId[] } | undefined;

/** The ids of every club with `status: 'active'` — the registry is the `clubs` collection itself. */
async function activeClubIds(): Promise<ClubId[]> {
  const now = Date.now();
  if (activeClubsCache && now - activeClubsCache.at < CLUB_CACHE_MS) return activeClubsCache.ids;
  const snap = await db.collection(paths.clubs()).get();
  const ids = snap.docs.filter((d) => (d.data() as Club).status === 'active').map((d) => d.id);
  activeClubsCache = { at: now, ids };
  return ids;
}

/**
 * The club a club-scoped callable acts in: its input's `clubId` (required by
 * every club-scoped schema since stage 1c).
 *
 * Only a club that exists and is active may be named. An unknown or suspended
 * club is refused here, before the handler reads or writes anything.
 */
export async function clubOf(input: { clubId: ClubId }): Promise<ClubPaths> {
  const { clubId } = input;
  if (!(await activeClubIds()).includes(clubId)) {
    // Not cached as a miss: a club created a moment ago must be usable at once.
    const club = (await db.doc(paths.club(clubId)).get()).data() as Club | undefined;
    if (!club) throw new HttpsError('not-found', 'Unknown club.');
    if (club.status !== 'active') throw new HttpsError('failed-precondition', 'This club is not available.');
    activeClubsCache = undefined;
  }
  return clubPaths(clubId);
}

/** Every active club, for jobs that sweep all of them (reminders, digests, purge, integrity). */
export async function allClubs(): Promise<ClubPaths[]> {
  return (await activeClubIds()).map((id) => clubPaths(id));
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

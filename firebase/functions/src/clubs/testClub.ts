/**
 * Creates (or tops up) a TEST club: its own club record, a copy of another
 * club's programme for one year, one existing person as its admin, and a
 * handful of clearly-fake members who sign in with a shared password.
 *
 * It exists so the multi-club work (plan §21 B14) can be exercised with a
 * real second club before any real second club exists. Nothing here is
 * special-cased by the app: a test club is an ordinary club whose data
 * happens to be fake.
 *
 * Idempotent. Re-running never overwrites a programme that is already there
 * and never duplicates a member; it does reset the fake members' password to
 * the one given, so a forgotten password is fixed by running it again.
 *
 * Takes `db` and `auth` rather than importing the Admin singletons, so the
 * emulator suite, the seed and the production script all drive the same code.
 */
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import {
  DEFAULT_NOTIFICATION_PREFS,
  MEMBER_GRADES,
  clubPaths,
  paths,
  type Club,
  type ClubId,
  type Member,
  type MemberPrivate,
} from '@obc/shared';

export interface TestClubOptions {
  clubId: ClubId;
  name: string;
  shortName: string;
  timezone: string;
  /** The club whose programme is copied. */
  sourceClubId: ClubId;
  /** Which programme year to copy. */
  year: number;
  /** An EXISTING person (looked up by login email) to make this club's admin. */
  adminEmail: string;
  /** How many fake members to create. */
  memberCount: number;
  /** Fake members are `testNN@<emailDomain>`. Use a domain that can never receive mail. */
  emailDomain: string;
  /** The one password every fake member signs in with. Never logged, never stored by this code. */
  password: string;
}

export interface TestClubReport {
  clubCreated: boolean;
  /** Programme documents copied (0 when the target year already existed). */
  programmeDocsCopied: number;
  admin: { memberId: string; created: boolean };
  members: Array<{ memberId: string; email: string; firstName: string; lastName: string; created: boolean }>;
}

const FIRST_NAMES = [
  'Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank', 'Grace', 'Heidi', 'Ivan', 'Judy',
  'Karl', 'Lena', 'Mallory', 'Niaj', 'Olivia', 'Peggy', 'Quentin', 'Rupert', 'Sybil', 'Trent',
];

function nn(i: number): string {
  return String(i + 1).padStart(2, '0');
}

/** The person-level index the rules read (see `userClubsWrite`, lib/clubs.ts). */
async function markActive(db: Firestore, uid: string, clubId: ClubId, now: string): Promise<void> {
  await db.doc(paths.user(uid)).set({ id: uid, clubIds: FieldValue.arrayUnion(clubId), updatedAt: now }, { merge: true });
}

async function copyCollection(
  db: Firestore,
  from: string,
  to: string,
  transform: (data: FirebaseFirestore.DocumentData) => FirebaseFirestore.DocumentData = (d) => d,
): Promise<number> {
  const snap = await db.collection(from).get();
  let batch = db.batch();
  let pending = 0;
  for (const doc of snap.docs) {
    batch.set(db.doc(`${to}/${doc.id}`), transform(doc.data()));
    pending += 1;
    if (pending === 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();
  return snap.size;
}

export async function provisionTestClub(db: Firestore, auth: Auth, opts: TestClubOptions): Promise<TestClubReport> {
  if (opts.clubId === opts.sourceClubId) throw new Error('The test club cannot be its own source club.');
  if (opts.password.length < 8) throw new Error('The fake members’ password must be at least 8 characters.');
  if (opts.memberCount < 0 || opts.memberCount > FIRST_NAMES.length) {
    throw new Error(`memberCount must be between 0 and ${FIRST_NAMES.length}.`);
  }

  const now = new Date().toISOString();
  const cp = clubPaths(opts.clubId);
  const source = clubPaths(opts.sourceClubId);

  // ---- 1. the club record ----
  const clubRef = db.doc(paths.club(opts.clubId));
  const clubCreated = !(await clubRef.get()).exists;
  if (clubCreated) {
    const club: Club = {
      id: opts.clubId,
      name: opts.name,
      shortName: opts.shortName,
      timezone: opts.timezone,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await clubRef.set(club);
  }

  // ---- 2. the programme: copied once, never overwritten ----
  let programmeDocsCopied = 0;
  const targetProgramme = db.doc(cp.programme(opts.year));
  if (!(await targetProgramme.get()).exists) {
    const sourceProgramme = await db.doc(source.programme(opts.year)).get();
    if (!sourceProgramme.exists) {
      throw new Error(`${source.programme(opts.year)} does not exist — nothing to copy.`);
    }
    // A steward is a member of the SOURCE club; the id means nothing here.
    programmeDocsCopied += await copyCollection(db, source.weekdays(opts.year), cp.weekdays(opts.year), (d) => {
      const { partnerStewardMemberId: _steward, ...rest } = d;
      void _steward;
      return rest;
    });
    programmeDocsCopied += await copyCollection(db, source.series(opts.year), cp.series(opts.year));
    programmeDocsCopied += await copyCollection(db, source.sessions(opts.year), cp.sessions(opts.year));
    // The year document last: the rules gate its sub-collections on its
    // `status`, so members never see a half-copied programme.
    await targetProgramme.set(sourceProgramme.data()!);
    programmeDocsCopied += 1;
  }

  // ---- 3. the admin: an existing person, attached to this club ----
  const adminEmail = opts.adminEmail.trim().toLowerCase();
  const adminPrivate = await db.collection(paths.userPrivates()).where('emailLower', '==', adminEmail).limit(1).get();
  if (adminPrivate.empty) {
    throw new Error('No existing person has that admin email. The admin must already be a member of some club.');
  }
  const adminUid = adminPrivate.docs[0]!.id;
  const adminRef = db.doc(cp.member(adminUid));
  const existingAdmin = (await adminRef.get()).data() as Member | undefined;
  if (existingAdmin) {
    if (existingAdmin.role !== 'admin' || existingAdmin.active !== true) {
      await adminRef.set({ role: 'admin', active: true, updatedAt: now }, { merge: true });
    }
  } else {
    // Their name comes from the club they already belong to. Deliberately no
    // phone: this club's directory is readable by the fake members, whose
    // password is shared.
    const elsewhere = (await db.doc(source.member(adminUid)).get()).data() as Member | undefined;
    const adminMember: Member = {
      id: adminUid,
      firstName: elsewhere?.firstName ?? 'Club',
      lastName: elsewhere?.lastName ?? 'Admin',
      phone: '',
      email: adminEmail,
      grade: elsewhere?.grade ?? 'Unknown',
      role: 'admin',
      cohort: 'club',
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    await adminRef.set(adminMember);
  }
  await markActive(db, adminUid, opts.clubId, now);

  // ---- 4. the fake members ----
  const members: TestClubReport['members'] = [];
  for (let i = 0; i < opts.memberCount; i++) {
    const firstName = FIRST_NAMES[i]!;
    const lastName = `TEST${nn(i)}`;
    const email = `test${nn(i)}@${opts.emailDomain}`.toLowerCase();

    let uid: string;
    try {
      uid = (await auth.getUserByEmail(email)).uid;
      await auth.updateUser(uid, { password: opts.password, disabled: false });
    } catch {
      uid = (await auth.createUser({ email, password: opts.password, emailVerified: true, disabled: false })).uid;
    }

    const privateRef = db.doc(paths.userPrivate(uid));
    if (!(await privateRef.get()).exists) {
      // Fake addresses cannot receive mail and have no devices: never notify them.
      const memberPrivate: MemberPrivate = {
        id: uid,
        emailLower: email,
        notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS, push: false, email: false, reminders: false },
        devices: [],
        hasPassword: true,
        createdAt: now,
        updatedAt: now,
      };
      await privateRef.set(memberPrivate);
    }

    const memberRef = db.doc(cp.member(uid));
    const created = !(await memberRef.get()).exists;
    if (created) {
      const member: Member = {
        id: uid,
        firstName,
        lastName,
        phone: '',
        email,
        grade: MEMBER_GRADES[i % 3]!,
        role: 'member',
        cohort: 'club',
        active: true,
        createdAt: now,
        updatedAt: now,
      };
      await memberRef.set(member);
    } else {
      await memberRef.set({ active: true, updatedAt: now }, { merge: true });
    }
    await markActive(db, uid, opts.clubId, now);
    members.push({ memberId: uid, email, firstName, lastName, created });
  }

  return { clubCreated, programmeDocsCopied, admin: { memberId: adminUid, created: !existingAdmin }, members };
}

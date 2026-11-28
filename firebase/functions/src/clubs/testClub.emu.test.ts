/**
 * A second club alongside the default one (plan §21 B14): created by
 * `provisionTestClub`, then driven through real handlers to show the two
 * clubs are separate.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  clubPaths,
  paths,
  type AddMemberInput,
  type Member,
  type MemberPrivate,
  type Session,
  type SetSoloStatusInput,
  type WeekdayProgramme,
} from '@obc/shared';
import { auth, db } from '../lib/admin.js';
import { cp as orewa, fakeCallableRequest, makeMember, makeProgramme, sessionInFuture } from '../testing/fixtures.js';
import { addMemberHandler } from '../admin/members.js';
import { setSoloStatusHandler } from '../entries/entries.js';
import { activeMembershipsOf } from '../lib/clubs.js';
import { provisionTestClub, type TestClubOptions, type TestClubReport } from './testClub.js';

const run = Date.now();
const CLUB_ID = `testclub-${run}`;
const test = clubPaths(CLUB_ID);
const adminEmail = `tc-admin-${run}@example.org`;
const PASSWORD = 'not-a-real-secret-1';

let adminUid: string;
let year: number;
let sessionId: string;
let options: TestClubOptions;
let report: TestClubReport;

beforeAll(async () => {
  adminUid = await makeMember(adminEmail, { role: 'member', firstName: 'Nell', lastName: 'Admin', phone: '021 000 0000' });
  const date = sessionInFuture('monday', 3);
  const programme = await makeProgramme({ dates: [date] });
  year = programme.year;
  sessionId = programme.sessionIds[0]!;
  // A steward in the source club — must not be carried into the copy.
  await db.doc(orewa.weekday(year, 'monday')).set({ partnerStewardMemberId: adminUid }, { merge: true });

  options = {
    clubId: CLUB_ID,
    name: 'TestClub',
    shortName: 'Test',
    timezone: 'Pacific/Auckland',
    sourceClubId: orewa.clubId,
    year,
    adminEmail,
    memberCount: 3,
    emailDomain: `tc${run}.example.test`,
    password: PASSWORD,
  };
  report = await provisionTestClub(db, auth, options);
});

describe('provisionTestClub', () => {
  it('creates the club and copies the programme, dropping the source club’s steward', async () => {
    expect(report.clubCreated).toBe(true);
    expect((await db.doc(paths.club(CLUB_ID)).get()).data()).toMatchObject({ name: 'TestClub', status: 'active' });

    expect((await db.doc(test.programme(year)).get()).data()).toEqual((await db.doc(orewa.programme(year)).get()).data());
    const copied = (await db.doc(test.session(year, sessionId)).get()).data() as Session;
    expect(copied).toEqual((await db.doc(orewa.session(year, sessionId)).get()).data());

    const weekday = (await db.doc(test.weekday(year, 'monday')).get()).data() as WeekdayProgramme;
    expect(weekday.label).toBeDefined();
    expect(weekday.partnerStewardMemberId).toBeUndefined();
  });

  it('attaches the existing person as this club’s admin without changing their role elsewhere', async () => {
    expect(report.admin).toEqual({ memberId: adminUid, created: true });
    const here = (await db.doc(test.member(adminUid)).get()).data() as Member;
    expect(here).toMatchObject({ role: 'admin', active: true, firstName: 'Nell', lastName: 'Admin', phone: '' });
    const there = (await db.doc(orewa.member(adminUid)).get()).data() as Member;
    expect(there.role).toBe('member');

    expect(((await db.doc(paths.user(adminUid)).get()).data()?.clubIds as string[]).sort()).toEqual(
      [CLUB_ID, orewa.clubId].sort(),
    );
    expect((await activeMembershipsOf(adminUid)).map((m) => m.cp.clubId).sort()).toEqual([CLUB_ID, orewa.clubId].sort());
  });

  it('creates fake members who can sign in with the password and are never notified', async () => {
    expect(report.members.map((m) => `${m.firstName} ${m.lastName}`)).toEqual(['Alice TEST01', 'Bob TEST02', 'Carol TEST03']);
    for (const m of report.members) {
      const user = await auth.getUser(m.memberId);
      expect(user.email).toBe(m.email);
      expect(user.disabled).toBe(false);
      expect(user.passwordHash).toBeDefined();
      const priv = (await db.doc(paths.userPrivate(m.memberId)).get()).data() as MemberPrivate;
      expect(priv.notificationPrefs).toMatchObject({ push: false, email: false, reminders: false });
      expect((await db.doc(test.member(m.memberId)).get()).data()).toMatchObject({ role: 'member', active: true, phone: '' });
      // Members of the test club only: nothing in the default club.
      expect((await db.doc(orewa.member(m.memberId)).get()).exists).toBe(false);
      expect((await db.doc(paths.user(m.memberId)).get()).data()?.clubIds).toEqual([CLUB_ID]);
    }
  });

  it('is idempotent: no duplicates, and an existing programme is left alone', async () => {
    await db.doc(test.session(year, sessionId)).set({ title: 'Edited in the test club' }, { merge: true });
    const again = await provisionTestClub(db, auth, options);

    expect(again.clubCreated).toBe(false);
    expect(again.programmeDocsCopied).toBe(0);
    expect(again.admin.created).toBe(false);
    expect(again.members.every((m) => !m.created)).toBe(true);
    expect(again.members.map((m) => m.memberId)).toEqual(report.members.map((m) => m.memberId));
    expect(((await db.doc(test.session(year, sessionId)).get()).data() as Session).title).toBe('Edited in the test club');
    expect((await db.collection(test.members()).get()).size).toBe(4);
  });

  it('refuses a missing admin, a weak password and copying a club onto itself', async () => {
    await expect(provisionTestClub(db, auth, { ...options, adminEmail: 'nobody-here@example.org' })).rejects.toThrow(/admin/);
    await expect(provisionTestClub(db, auth, { ...options, password: 'short' })).rejects.toThrow(/8 characters/);
    await expect(provisionTestClub(db, auth, { ...options, clubId: orewa.clubId })).rejects.toThrow(/own source/);
  });
});

describe('two clubs side by side', () => {
  it('a callable acts only in the club it names', async () => {
    const fake = report.members[0]!.memberId;

    // The fake member lists themselves as available — in the test club.
    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>({ clubId: CLUB_ID, year, sessionId, status: 'available' }, { uid: fake }),
    );
    expect((await db.collection(test.entries()).where('memberId', '==', fake).get()).size).toBe(1);
    expect((await db.collection(orewa.entries()).where('memberId', '==', fake).get()).size).toBe(0);

    // They are not a member of the default club, so the same call there is refused.
    await expect(
      setSoloStatusHandler(fakeCallableRequest<SetSoloStatusInput>({ year, sessionId, status: 'available' }, { uid: fake })),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('admin rights are per club', async () => {
    const newMember: Omit<AddMemberInput, 'clubId'> = {
      firstName: 'Zed',
      lastName: 'TESTZZ',
      email: `tc-added-${run}@example.org`,
      grade: 'Open',
    };

    // Admin of the test club: allowed there…
    const added = await addMemberHandler(fakeCallableRequest<AddMemberInput>({ clubId: CLUB_ID, ...newMember }, { uid: adminUid }));
    expect((await db.doc(test.member(added.member.id)).get()).exists).toBe(true);
    expect((await db.doc(orewa.member(added.member.id)).get()).exists).toBe(false);

    // …but only an ordinary member of the default club.
    await expect(
      addMemberHandler(
        fakeCallableRequest<AddMemberInput>({ ...newMember, email: `tc-added2-${run}@example.org` }, { uid: adminUid }),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('a suspended club is refused', async () => {
    await db.doc(paths.club(CLUB_ID)).set({ status: 'suspended' }, { merge: true });
    await expect(
      setSoloStatusHandler(
        fakeCallableRequest<SetSoloStatusInput>(
          { clubId: CLUB_ID, year, sessionId, status: 'available' },
          { uid: report.members[1]!.memberId },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    // …and its memberships no longer count towards "active somewhere".
    expect(await activeMembershipsOf(report.members[1]!.memberId)).toEqual([]);
    await db.doc(paths.club(CLUB_ID)).set({ status: 'active' }, { merge: true });
  });
});

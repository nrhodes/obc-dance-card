import { describe, expect, it } from 'vitest';
import type { ImportMembersInput } from '@obc/shared';
import { paths } from '@obc/shared';
import { auth, db } from '../lib/admin.js';
import { fakeCallableRequest, makeMember } from '../testing/fixtures.js';
import { importMembersHandler } from './importMembers.js';

const HEADER = 'firstName,lastName,email,phone,grade';

function csv(rows: string[][]): string {
  return [HEADER, ...rows.map((r) => r.join(','))].join('\n');
}

async function adminReq(input: ImportMembersInput) {
  const adminUid = await makeMember(`admin-caller-${Date.now()}-${Math.random()}@example.org`, { role: 'admin' });
  return fakeCallableRequest<ImportMembersInput>(input, { uid: adminUid });
}

describe('importMembers', () => {
  it('rejects a CSV with the wrong header set before processing any row', async () => {
    const badCsv = 'firstName,lastName,email,phone\nJane,Doe,jane@example.org,021';
    await expect(importMembersHandler(await adminReq({ csv: badCsv }))).rejects.toMatchObject({
      code: 'invalid-argument',
    });

    const snap = await auth.getUserByEmail('jane@example.org').catch(() => null);
    expect(snap).toBeNull();
  });

  it('rejects more than 2000 rows', async () => {
    const rows = Array.from({ length: 2001 }, (_, i) => [`F${i}`, `L${i}`, `row${i}@example.org`, '', 'Open']);
    await expect(importMembersHandler(await adminReq({ csv: csv(rows) }))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  }, 20_000);

  it('dry run validates but writes nothing', async () => {
    const email = 'dryrun1@example.org';
    const report = await importMembersHandler(
      await adminReq({ csv: csv([['Dry', 'Run', email, '021 000 0001', 'Open']]), dryRun: true }),
    );

    expect(report.errors).toEqual([]);
    expect(report.added).toBe(1);

    const authUser = await auth.getUserByEmail(email).catch(() => null);
    expect(authUser).toBeNull();

    const privateDocs = await db.collection('memberPrivate').where('emailLower', '==', email).get();
    expect(privateDocs.empty).toBe(true);
  });

  it('happy path: creates an Auth user + members + memberPrivate docs', async () => {
    const email = 'happypath1@example.org';
    const report = await importMembersHandler(
      await adminReq({ csv: csv([['Happy', 'Path', email, '021 000 0002', 'Intermediate']]) }),
    );

    expect(report.errors).toEqual([]);
    expect(report.added).toBe(1);

    const authUser = await auth.getUserByEmail(email);
    expect(authUser).toBeTruthy();

    const memberSnap = await db.doc(paths.member(authUser.uid)).get();
    expect(memberSnap.data()).toMatchObject({
      firstName: 'Happy',
      lastName: 'Path',
      phone: '021 000 0002',
      grade: 'Intermediate',
      role: 'member',
      active: true,
    });

    const privateSnap = await db.doc(paths.memberPrivate(authUser.uid)).get();
    expect(privateSnap.data()).toMatchObject({ emailLower: email, hasPassword: false, devices: [] });
  });

  it('duplicate email within the file is a row error for every occurrence; other rows still import', async () => {
    const dup = 'duplicate1@example.org';
    const unique = 'unique1@example.org';
    const report = await importMembersHandler(
      await adminReq({
        csv: csv([
          ['Dup', 'One', dup, '', 'Open'],
          ['Unique', 'Row', unique, '', 'Open'],
          ['Dup', 'Two', dup, '', 'Open'],
        ]),
      }),
    );

    expect(report.added).toBe(1); // only the unique row
    expect(report.errors).toHaveLength(2);
    expect(report.errors.every((e) => e.message.includes('duplicated'))).toBe(true);
    expect(report.errors.map((e) => e.row).sort()).toEqual([1, 3]);

    await expect(auth.getUserByEmail(dup)).rejects.toBeTruthy();
    await expect(auth.getUserByEmail(unique)).resolves.toBeTruthy();
  });

  it('a row with a bad email is a row error; the rest of the file still imports', async () => {
    const good = 'goodemail1@example.org';
    const report = await importMembersHandler(
      await adminReq({
        csv: csv([
          ['Bad', 'Email', 'not-an-email', '', 'Open'],
          ['Good', 'Email', good, '', 'Open'],
        ]),
      }),
    );

    expect(report.added).toBe(1);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatchObject({ row: 1 });
    expect(report.errors[0]!.message).toContain('email');

    await expect(auth.getUserByEmail(good)).resolves.toBeTruthy();
  });

  it('re-import updates an existing member, deactivates an absent non-admin (disabling their Auth user), and never deactivates an admin (warns instead)', async () => {
    const staying = 'reimport-staying@example.org';
    const goingAway = 'reimport-goingaway@example.org';
    const adminEmail = 'reimport-admin@example.org';

    // Baseline: two ordinary members already provisioned, plus an existing admin.
    const goingAwayUid = await makeMember(goingAway, { role: 'member', active: true });
    const adminUid = await makeMember(adminEmail, { role: 'admin', active: true });

    // First import brings in `staying` and re-affirms `goingAway`, but the
    // admin is never in any members.csv (admins are managed via
    // setMemberRole, not the import file).
    const report1 = await importMembersHandler(
      await adminReq({
        allowMassDeactivation: true,
        csv: csv([
          ['Staying', 'Member', staying, '021', 'Open'],
          ['Going', 'Away', goingAway, '021', 'Open'],
        ]),
      }),
    );
    expect(report1.errors).toEqual([]);

    // Second import omits `goingAway` — it should be deactivated — and
    // changes `staying`'s phone/grade, which should register as 'updated'.
    const report2 = await importMembersHandler(
      await adminReq({ csv: csv([['Staying', 'Member', staying, '099', 'Open']]), allowMassDeactivation: true }),
    );
    expect(report2.errors).toEqual([]);

    const stayingUid = (await auth.getUserByEmail(staying)).uid;
    const stayingMember = (await db.doc(paths.member(stayingUid)).get()).data();
    expect(stayingMember).toMatchObject({ phone: '099', active: true });

    const goingAwayMember = (await db.doc(paths.member(goingAwayUid)).get()).data();
    expect(goingAwayMember?.active).toBe(false);
    const goingAwayAuth = await auth.getUser(goingAwayUid);
    expect(goingAwayAuth.disabled).toBe(true);

    const adminMember = (await db.doc(paths.member(adminUid)).get()).data();
    expect(adminMember?.active).toBe(true); // never deactivated
    const adminAuth = await auth.getUser(adminUid);
    expect(adminAuth.disabled).toBe(false);
    expect(report2.warnings.some((w) => w.includes(adminUid))).toBe(true);

    // Re-importing `goingAway` reactivates it and re-enables the Auth user.
    const report3 = await importMembersHandler(
      await adminReq({
        allowMassDeactivation: true,
        csv: csv([
          ['Staying', 'Member', staying, '099', 'Open'],
          ['Going', 'Away', goingAway, '021', 'Open'],
        ]),
      }),
    );
    expect(report3.errors).toEqual([]);
    const revivedMember = (await db.doc(paths.member(goingAwayUid)).get()).data();
    expect(revivedMember?.active).toBe(true);
    const revivedAuth = await auth.getUser(goingAwayUid);
    expect(revivedAuth.disabled).toBe(false);
  }, 30_000);

  it('a row that fails validation still protects that member from deactivation', async () => {
    const email = `protect-${Date.now()}@example.org`;
    const uid = await makeMember(email, { role: 'member', active: true });

    // Blank surname → row error. The member is *mentioned*, so must not be deactivated.
    const report = await importMembersHandler(
      await adminReq({ csv: csv([['Protected', '', email, '021', 'Open']]), allowMassDeactivation: true }),
    );
    expect(report.errors.some((e) => e.message.includes('lastName'))).toBe(true);
    const member = (await db.doc(paths.member(uid)).get()).data();
    expect(member?.active).toBe(true);
    expect((await auth.getUser(uid)).disabled).toBe(false);
  });

  it('refuses a mass deactivation unless allowMassDeactivation is set', async () => {
    // The threshold is max(5, 20% of *every* currently-active member in the
    // project) — and this suite shares one emulator with every other
    // `*.emu.test.ts` file in the same run, some of which create their own
    // active members. Count the current baseline and create comfortably more
    // than enough on top of it, rather than a fixed 6, so this assertion
    // holds regardless of what else has run.
    const baselineSnap = await db.collection('members').where('active', '==', true).get();
    const activeBefore = baselineSnap.size;
    const toCreate = Math.ceil(activeBefore * 0.25) + 10; // always exceeds max(5, 20% of the new total)

    const uids: string[] = [];
    for (let i = 0; i < toCreate; i++) {
      uids.push(await makeMember(`mass-${Date.now()}-${i}@example.org`, { role: 'member', active: true }));
    }
    const report = await importMembersHandler(
      await adminReq({ csv: csv([['Only', 'One', `mass-only-${Date.now()}@example.org`, '021', 'Open']]) }),
    );
    expect(report.deactivated).toBe(0);
    expect(report.warnings.some((w) => w.includes('allowMassDeactivation'))).toBe(true);
    for (const uid of uids) {
      expect((await db.doc(paths.member(uid)).get()).data()?.active).toBe(true);
      expect((await auth.getUser(uid)).disabled).toBe(false);
    }
  }, 30_000);
});

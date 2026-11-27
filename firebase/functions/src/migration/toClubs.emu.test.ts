/**
 * Rehearsal of the stage-1b migration (plan §21 B14.8) against the emulator.
 *
 * It migrates into its own club id, so it cannot disturb the club every other
 * suite uses. The pre-migration top-level collections it seeds are written by
 * nothing else any more, so they are this file's alone.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { clubPaths, paths, type Club } from '@obc/shared';
import { db } from '../lib/admin.js';
import { MigrationClosedError, closeClubsMigration, migrateToClubs, verifyClubsMigration } from './toClubs.js';

const CLUB_ID = 'migration-rehearsal';
const cp = clubPaths(CLUB_ID);
const club: Club = {
  id: CLUB_ID,
  name: 'Rehearsal Club',
  shortName: 'Rehearsal',
  timezone: 'Pacific/Auckland',
  status: 'active',
  createdAt: '2026-11-28T00:00:00.000Z',
  updatedAt: '2026-11-28T00:00:00.000Z',
};

/** Unique per run: the emulator's store persists across the whole suite. */
const run = `mig${Date.now()}`;
const activeUid = `${run}-active`;
const inactiveUid = `${run}-inactive`;
const year = '2031';

const legacy: Record<string, Record<string, unknown>> = {
  [`members/${activeUid}`]: { id: activeUid, firstName: 'Ada', lastName: 'Active', active: true, role: 'admin', cohort: 'club' },
  [`members/${inactiveUid}`]: { id: inactiveUid, firstName: 'Ian', lastName: 'Inactive', active: false, role: 'member', cohort: 'club' },
  [`memberPrivate/${activeUid}`]: { id: activeUid, emailLower: `${run}-a@example.org`, devices: [], hasPassword: false },
  [`memberPrivate/${inactiveUid}`]: { id: inactiveUid, emailLower: `${run}-i@example.org`, devices: [], hasPassword: true },
  [`entries/${run}-e1`]: { id: `${run}-e1`, memberId: activeUid, date: '2031-03-03', status: 'available', partner: null },
  [`invites/${run}-i1`]: { id: `${run}-i1`, fromMemberId: activeUid, toMemberId: inactiveUid, status: 'pending' },
  [`teams/${run}-t1`]: { id: `${run}-t1`, captainMemberId: activeUid, members: [{ ref: { kind: 'member', memberId: activeUid } }] },
  [`visitors/${run}-v1`]: { id: `${run}-v1`, displayName: 'Vera Visitor', createdByMemberId: activeUid },
  [`auditLog/${run}-a1`]: { id: `${run}-a1`, action: 'member_import', actorMemberId: activeUid },
  [`imports/${run}-imp1`]: { id: `${run}-imp1`, kind: 'members' },
  [`integrity/${run}-int1`]: { id: `${run}-int1`, violations: [] },
  [`programmes/${year}`]: { year: 2031, status: 'published' },
  [`programmes/${year}/weekdays/monday`]: { weekday: 'monday', label: 'Monday', startTime: '13:00' },
  [`programmes/${year}/series/${run}-s1`]: { id: `${run}-s1`, name: 'Autumn Pairs', sessionIds: [`${run}-s1-2031-03-03`] },
  [`programmes/${year}/sessions/${run}-s1-2031-03-03`]: { id: `${run}-s1-2031-03-03`, date: '2031-03-03' },
};

/** Where each legacy document should end up. */
function target(oldPath: string): string {
  if (oldPath.startsWith('memberPrivate/')) return oldPath.replace('memberPrivate/', 'userPrivate/');
  return `clubs/${CLUB_ID}/${oldPath}`;
}

async function read(path: string): Promise<Record<string, unknown> | undefined> {
  return (await db.doc(path).get()).data();
}

beforeAll(async () => {
  for (const [path, data] of Object.entries(legacy)) await db.doc(path).set(data);
});

describe('migrateToClubs', () => {
  it('a dry run reports what it would do and writes nothing', async () => {
    const report = await migrateToClubs(db, { clubId: CLUB_ID, club, execute: false });

    expect(report.execute).toBe(false);
    expect(report.clubDocCreated).toBe(true);
    expect(report.totalWrites).toBeGreaterThanOrEqual(Object.keys(legacy).length);
    expect(await read(paths.club(CLUB_ID))).toBeUndefined();
    expect(await read(cp.member(activeUid))).toBeUndefined();
    expect(await read(paths.userPrivate(activeUid))).toBeUndefined();
    expect(await read(paths.user(activeUid))).toBeUndefined();
  });

  it('copies every document unchanged, derives users/{uid}, and leaves the old data alone', async () => {
    const report = await migrateToClubs(db, { clubId: CLUB_ID, club, execute: true });
    expect(report.clubDocCreated).toBe(true);

    for (const [oldPath, data] of Object.entries(legacy)) {
      expect(await read(target(oldPath)), target(oldPath)).toEqual(data);
      expect(await read(oldPath), oldPath).toEqual(data);
    }
    expect(await read(paths.club(CLUB_ID))).toEqual(club);

    expect((await read(paths.user(activeUid)))?.clubIds).toEqual([CLUB_ID]);
    expect((await read(paths.user(inactiveUid)))?.clubIds).toEqual([]);

    const members = report.collections.find((c) => c.from === 'members')!;
    expect(members.to).toBe(cp.members());
    expect(members.created).toBeGreaterThanOrEqual(2);
    const sessions = report.collections.find((c) => c.from === `programmes/${year}/sessions`)!;
    expect(sessions.to).toBe(cp.sessions(year));

    const verify = await verifyClubsMigration(db, CLUB_ID);
    expect(verify.problems).toEqual([]);
    expect(verify.checked).toBeGreaterThanOrEqual(Object.keys(legacy).length);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const report = await migrateToClubs(db, { clubId: CLUB_ID, club, execute: true });
    expect(report.clubDocCreated).toBe(false);
    expect(report.totalWrites).toBe(0);
    for (const c of report.collections) {
      expect(c.created, c.from).toBe(0);
      expect(c.refreshed, c.from).toBe(0);
    }
  });

  it('catch-up: re-copies a document the old build changed after the first run', async () => {
    await db.doc(`entries/${run}-e1`).update({ status: 'looking_for_partner' });
    await db.doc(`members/${activeUid}`).update({ active: false });

    // Before catching up, verify says the new layout is behind.
    const before = await verifyClubsMigration(db, CLUB_ID);
    expect(before.problems.map((p) => p.path).sort()).toEqual([cp.entry(`${run}-e1`), cp.member(activeUid)].sort());

    const report = await migrateToClubs(db, { clubId: CLUB_ID, club, execute: true });
    expect(report.collections.find((c) => c.from === 'entries')!.refreshed).toBe(1);
    expect((await read(cp.entry(`${run}-e1`)))?.status).toBe('looking_for_partner');
    // The membership's new `active` flag reaches the person-level index too.
    expect((await read(cp.member(activeUid)))?.active).toBe(false);
    expect((await read(paths.user(activeUid)))?.clubIds).toEqual([]);

    expect((await verifyClubsMigration(db, CLUB_ID)).problems).toEqual([]);
  });

  it('never overwrites a document the new build has changed since, or one only the new build created', async () => {
    await db.doc(cp.visitor(`${run}-v1`)).update({ displayName: 'Vera Renamed' });
    await db.doc(cp.entry(`${run}-new-only`)).set({ id: `${run}-new-only`, status: 'available' });

    const report = await migrateToClubs(db, { clubId: CLUB_ID, club, execute: true });
    const visitors = report.collections.find((c) => c.from === 'visitors')!;
    expect(visitors.keptNewer).toBeGreaterThanOrEqual(1);
    expect(visitors.refreshed).toBe(0);
    expect((await read(cp.visitor(`${run}-v1`)))?.displayName).toBe('Vera Renamed');
    expect(await read(cp.entry(`${run}-new-only`))).toBeDefined();
    expect(report.collections.find((c) => c.from === 'entries')!.onlyInNew).toBeGreaterThanOrEqual(1);

    const verify = await verifyClubsMigration(db, CLUB_ID);
    expect(verify.problems).toEqual([]);
    expect(verify.keptNewer).toBeGreaterThanOrEqual(1);
    expect(verify.onlyInNew).toBeGreaterThanOrEqual(1);
  });

  it('once closed, refuses to copy again — a later run could resurrect documents the live app deleted', async () => {
    const closedAt = await closeClubsMigration(db, CLUB_ID, '2026-11-28T03:00:00.000Z');
    expect(closedAt).toBe('2026-11-28T03:00:00.000Z');
    // Closing twice keeps the first timestamp.
    expect(await closeClubsMigration(db, CLUB_ID, '2026-12-01T00:00:00.000Z')).toBe('2026-11-28T03:00:00.000Z');

    // The live app deletes a visitor; the old copy is still there.
    await db.doc(cp.visitor(`${run}-v1`)).delete();
    await expect(migrateToClubs(db, { clubId: CLUB_ID, club, execute: true })).rejects.toBeInstanceOf(MigrationClosedError);
    expect(await read(cp.visitor(`${run}-v1`))).toBeUndefined();

    // Reading is still allowed: a dry run and verify both work on a closed migration.
    const dry = await migrateToClubs(db, { clubId: CLUB_ID, club, execute: false });
    expect(dry.execute).toBe(false);
    await verifyClubsMigration(db, CLUB_ID);
  });
});

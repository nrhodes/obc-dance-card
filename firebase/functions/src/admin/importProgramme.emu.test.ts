import { beforeAll, describe, expect, it } from 'vitest';
import type { Entry, ImportProgrammeInput } from '@obc/shared';
import { paths } from '@obc/shared';
import { db } from '../lib/admin.js';
import { fakeCallableRequest, makeMember } from '../testing/fixtures.js';
import { importProgrammeHandler } from './importProgramme.js';

function weekdaysCsv(rows: string[][]): string {
  return ['weekday,label,startTime,seatedBy,stewardEmail,notes', ...rows.map((r) => r.join(','))].join('\n');
}
function seriesCsv(rows: string[][]): string {
  return [
    'weekday,name,scoring,format,bestOfN,bestOfM,allowSubstitute,eligibilityNote,note,dates',
    ...rows.map((r) => r.join(',')),
  ].join('\n');
}
function singlesCsv(rows: string[][]): string {
  return ['date,weekday,kind,title,partnerRequired', ...rows.map((r) => r.join(','))].join('\n');
}

const EMPTY_SERIES = seriesCsv([]);
const EMPTY_SINGLES = singlesCsv([]);

// ImportProgrammeInputSchema caps year at 2100; stay well inside that range
// while still giving every test its own year so programme state never leaks.
let yearCounter = 2050;
function freshYear(): number {
  return yearCounter++;
}

// One admin caller shared by every test in this file: importProgramme itself
// needs the caller to be an admin, but this file has no interest in *how
// many* admins exist, so avoid inflating the shared emulator's active-member
// count (importMembers' mass-deactivation math counts every active member in
// the whole project, and other emu test files run in the same process).
let adminUid: string;
beforeAll(async () => {
  adminUid = await makeMember(`admin-prog-${Date.now()}-${Math.random()}@example.org`, { role: 'admin' });
});

async function adminReq(input: ImportProgrammeInput) {
  return fakeCallableRequest<ImportProgrammeInput>(input, { uid: adminUid });
}

async function programmeExists(year: number): Promise<boolean> {
  const snap = await db.doc(paths.programme(year)).get();
  return snap.exists;
}

describe('importProgramme', () => {
  it('dry run validates and reports counts but writes nothing', async () => {
    const year = freshYear();
    const [monday] = mondaysFor(year, 1);
    const report = await importProgrammeHandler(
      await adminReq({
        year,
        weekdaysCsv: weekdaysCsv([['monday', 'Monday Afternoon', '13:00', '12:45', '', '']]),
        seriesCsv: seriesCsv([['monday', 'Marion Taylor Pairs', 'Scr', 'Pairs', '', '', 'yes', '', '', monday!]]),
        singlesCsv: EMPTY_SINGLES,
        dryRun: true,
      }),
    );

    expect(report.errors).toEqual([]);
    expect(report.weekdays).toBe(1);
    expect(report.series).toBe(1);
    expect(report.sessions).toBe(1);
    expect(await programmeExists(year)).toBe(false);
  });

  it('happy path: writes weekdays/series/sessions with deterministic ids, denormalised fields, sorted sessionIds', async () => {
    const year = freshYear();
    // 2027-01-04 is a Monday; reuse the same weekday for every date so the
    // fixture doesn't need to hunt for real calendar dates per test year.
    // Instead, pick dates relative to a known Monday anchor per `year`.
    const mondayDates = mondaysFor(year, 2);
    const report = await importProgrammeHandler(
      await adminReq({
        year,
        weekdaysCsv: weekdaysCsv([['monday', 'Monday Afternoon', '13:00', '12:45', '', '']]),
        seriesCsv: seriesCsv([
          ['monday', 'Marion Taylor Pairs', 'Scr', 'Pairs', '', '', 'yes', '', '', `${mondayDates[1]};${mondayDates[0]}`],
        ]),
        singlesCsv: EMPTY_SINGLES,
      }),
    );

    expect(report.errors).toEqual([]);
    expect(report.weekdays).toBe(1);
    expect(report.series).toBe(1);
    expect(report.sessions).toBe(2);

    const programmeSnap = await db.doc(paths.programme(year)).get();
    expect(programmeSnap.data()).toMatchObject({ status: 'draft', year });

    const weekdaySnap = await db.doc(paths.weekday(year, 'monday')).get();
    expect(weekdaySnap.data()).toMatchObject({ id: 'monday', startTime: '13:00', seatedByTime: '12:45' });

    const seriesId = 'monday-marion-taylor-pairs';
    const seriesSnap = await db.doc(paths.seriesDoc(year, seriesId)).get();
    const seriesData = seriesSnap.data();
    expect(seriesData).toMatchObject({
      id: seriesId,
      weekday: 'monday',
      name: 'Marion Taylor Pairs',
      scoring: 'Scr',
      format: 'Pairs',
      teamMin: 4,
      teamMax: 6,
    });
    // sorted ascending by date, regardless of CSV order.
    expect(seriesData?.sessionIds).toEqual([`${seriesId}-${mondayDates[0]}`, `${seriesId}-${mondayDates[1]}`]);

    const sessionSnap = await db.doc(paths.session(year, `${seriesId}-${mondayDates[0]}`)).get();
    expect(sessionSnap.data()).toMatchObject({
      date: mondayDates[0],
      weekday: 'monday',
      seriesId,
      kind: 'series',
      partnerRequired: true,
      seriesName: 'Marion Taylor Pairs',
      scoring: 'Scr',
      format: 'Pairs',
    });
  });

  it('a date whose actual weekday does not match the row is a row error and nothing is written', async () => {
    const year = freshYear();
    const [monday] = mondaysFor(year, 1);
    const tuesday = addDays(monday!, 1); // definitely not a Monday
    const report = await importProgrammeHandler(
      await adminReq({
        year,
        weekdaysCsv: weekdaysCsv([['monday', 'Monday Afternoon', '13:00', '12:45', '', '']]),
        seriesCsv: seriesCsv([['monday', 'Marion Taylor Pairs', 'Scr', 'Pairs', '', '', 'yes', '', '', tuesday]]),
        singlesCsv: EMPTY_SINGLES,
      }),
    );
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors[0]!.message).toMatch(/not a monday/);
    expect(await programmeExists(year)).toBe(false);
  });

  it('duplicate (date, weekday) across series and singles is an error and nothing is written', async () => {
    const year = freshYear();
    const [monday] = mondaysFor(year, 1);
    const report = await importProgrammeHandler(
      await adminReq({
        year,
        weekdaysCsv: weekdaysCsv([['monday', 'Monday Afternoon', '13:00', '12:45', '', '']]),
        seriesCsv: seriesCsv([['monday', 'Marion Taylor Pairs', 'Scr', 'Pairs', '', '', 'yes', '', '', monday!]]),
        singlesCsv: singlesCsv([[monday!, 'monday', 'holidayBridge', 'Holiday Bridge', 'yes']]),
      }),
    );
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors.some((e) => e.message.includes('more than one session'))).toBe(true);
    expect(await programmeExists(year)).toBe(false);
  });

  it('an unresolvable stewardEmail is a row error', async () => {
    const year = freshYear();
    const report = await importProgrammeHandler(
      await adminReq({
        year,
        weekdaysCsv: weekdaysCsv([['monday', 'Monday Afternoon', '13:00', '12:45', 'nobody@example.org', '']]),
        seriesCsv: EMPTY_SERIES,
        singlesCsv: EMPTY_SINGLES,
      }),
    );
    expect(report.errors.length).toBe(1);
    expect(report.errors[0]!.message).toMatch(/stewardEmail/);
    expect(await programmeExists(year)).toBe(false);
  });

  it('a series referencing a weekday absent from weekdays.csv is a row error', async () => {
    const year = freshYear();
    const [monday] = mondaysFor(year, 1);
    const report = await importProgrammeHandler(
      await adminReq({
        year,
        weekdaysCsv: weekdaysCsv([['tuesday', 'Tuesday Evening', '19:00', '18:45', '', '']]),
        seriesCsv: seriesCsv([['monday', 'Marion Taylor Pairs', 'Scr', 'Pairs', '', '', 'yes', '', '', monday!]]),
        singlesCsv: EMPTY_SINGLES,
      }),
    );
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors[0]!.message).toMatch(/no corresponding row in weekdays\.csv/);
    expect(await programmeExists(year)).toBe(false);
  });

  it('bestOfN greater than bestOfM is a row error', async () => {
    const year = freshYear();
    const [monday] = mondaysFor(year, 1);
    const report = await importProgrammeHandler(
      await adminReq({
        year,
        weekdaysCsv: weekdaysCsv([['monday', 'Monday Afternoon', '13:00', '12:45', '', '']]),
        seriesCsv: seriesCsv([['monday', 'Champ Pairs', 'Scr', 'Pairs', '6', '5', 'no', '', '', monday!]]),
        singlesCsv: EMPTY_SINGLES,
      }),
    );
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors[0]!.message).toMatch(/bestOfN/);
    expect(await programmeExists(year)).toBe(false);
  });

  it('refuses to overwrite an already-published year without replace: true', async () => {
    const year = freshYear();
    await db.doc(paths.programme(year)).set({ id: String(year), year, status: 'published', createdAt: 'now', updatedAt: 'now' });

    await expect(
      importProgrammeHandler(
        await adminReq({
          year,
          weekdaysCsv: weekdaysCsv([['monday', 'Monday Afternoon', '13:00', '12:45', '', '']]),
          seriesCsv: EMPTY_SERIES,
          singlesCsv: EMPTY_SINGLES,
        }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('replace: true refuses when a removed session has a non-cancelled entry, and writes nothing', async () => {
    const year = freshYear();
    const [d1, d2] = mondaysFor(year, 2);
    const seriesId = 'monday-two-week-pairs';

    // Establish a published programme with two sessions.
    const initial = await importProgrammeHandler(
      await adminReq({
        year,
        weekdaysCsv: weekdaysCsv([['monday', 'Monday Afternoon', '13:00', '12:45', '', '']]),
        seriesCsv: seriesCsv([['monday', 'Two Week Pairs', 'Scr', 'Pairs', '', '', 'yes', '', '', `${d1};${d2}`]]),
        singlesCsv: EMPTY_SINGLES,
      }),
    );
    expect(initial.errors).toEqual([]);
    await db.doc(paths.programme(year)).update({ status: 'published', publishedAt: 'now' });

    const removedSessionId = `${seriesId}-${d2}`;
    const entry: Entry = {
      id: `${removedSessionId}_someone`,
      sessionId: removedSessionId,
      date: d2!,
      weekday: 'monday',
      seriesId,
      memberId: 'someone',
      status: 'confirmed',
      partner: null,
      pairingId: null,
      teamId: null,
      teamSessionOnly: false,
      substitute: null,
      partnerSubstitute: null,
      isSubstituteFor: null,
      createdBy: 'someone',
      createdAt: 'now',
      updatedAt: 'now',
    };
    await db.doc(paths.entry(entry.id)).set(entry);

    await expect(
      importProgrammeHandler(
        await adminReq({
          year,
          replace: true,
          weekdaysCsv: weekdaysCsv([['monday', 'Monday Afternoon', '13:00', '12:45', '', '']]),
          seriesCsv: seriesCsv([['monday', 'Two Week Pairs', 'Scr', 'Pairs', '', '', 'yes', '', '', d1!]]),
          singlesCsv: EMPTY_SINGLES,
        }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    // Nothing was touched: the removed session doc is still there.
    const stillThere = await db.doc(paths.session(year, removedSessionId)).get();
    expect(stillThere.exists).toBe(true);
  });

  it('replace: true succeeds once the removed session\'s only entry is cancelled, and the old docs are gone', async () => {
    const year = freshYear();
    const [d1, d2] = mondaysFor(year, 2);
    const seriesId = 'monday-two-week-pairs';

    const initial = await importProgrammeHandler(
      await adminReq({
        year,
        weekdaysCsv: weekdaysCsv([['monday', 'Monday Afternoon', '13:00', '12:45', '', '']]),
        seriesCsv: seriesCsv([['monday', 'Two Week Pairs', 'Scr', 'Pairs', '', '', 'yes', '', '', `${d1};${d2}`]]),
        singlesCsv: EMPTY_SINGLES,
      }),
    );
    expect(initial.errors).toEqual([]);
    await db.doc(paths.programme(year)).update({ status: 'published', publishedAt: 'now' });

    const removedSessionId = `${seriesId}-${d2}`;
    const entry: Entry = {
      id: `${removedSessionId}_someone`,
      sessionId: removedSessionId,
      date: d2!,
      weekday: 'monday',
      seriesId,
      memberId: 'someone',
      status: 'cancelled',
      partner: null,
      pairingId: null,
      teamId: null,
      teamSessionOnly: false,
      substitute: null,
      partnerSubstitute: null,
      isSubstituteFor: null,
      createdBy: 'someone',
      createdAt: 'now',
      updatedAt: 'now',
    };
    await db.doc(paths.entry(entry.id)).set(entry);

    const report = await importProgrammeHandler(
      await adminReq({
        year,
        replace: true,
        weekdaysCsv: weekdaysCsv([['monday', 'Monday Afternoon', '13:00', '12:45', '', '']]),
        seriesCsv: seriesCsv([['monday', 'Two Week Pairs', 'Scr', 'Pairs', '', '', 'yes', '', '', d1!]]),
        singlesCsv: EMPTY_SINGLES,
      }),
    );
    expect(report.errors).toEqual([]);
    expect(report.wouldRemoveSessions).toBe(1);
    expect(report.sessions).toBe(1);

    const gone = await db.doc(paths.session(year, removedSessionId)).get();
    expect(gone.exists).toBe(false);
    const kept = await db.doc(paths.session(year, `${seriesId}-${d1}`)).get();
    expect(kept.exists).toBe(true);

    const programmeSnap = await db.doc(paths.programme(year)).get();
    expect(programmeSnap.data()?.status).toBe('published'); // replace keeps the prior status
  });

  it(
    'regression: stored session count always equals the reported count, even when re-importing a large ' +
      'multi-series multi-weekday programme pushes the delete+recreate write past one Firestore batch ' +
      '(real bug: BatchWriter used to fire batches concurrently, letting a stale delete of an old session ' +
      'race ahead of -- and silently wipe out -- its own recreate once the op count crossed 400)',
    async () => {
      const year = freshYear();
      const weekdayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;
      const isoWeekdayFor: Record<(typeof weekdayNames)[number], number> = {
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
      };

      const wdRows = weekdayNames.map((wd) => [wd, `${wd} afternoon`, '13:00', '12:45', '', '']);
      const seriesRows: string[][] = [];
      for (const wd of weekdayNames) {
        // 40 distinct same-weekday dates split into two non-overlapping
        // 20-date series so no two rows collide on (date, weekday).
        const dates = datesForWeekday(year, isoWeekdayFor[wd], 40);
        seriesRows.push([wd, `${wd} Series A`, 'Scr', 'Pairs', '', '', 'yes', '', '', dates.slice(0, 20).join(';')]);
        seriesRows.push([wd, `${wd} Series B`, 'Scr', 'Pairs', '', '', 'yes', '', '', dates.slice(20, 40).join(';')]);
      }
      // 5 weekdays x 2 series x 20 dates = 200 sessions, 10 series, 5 weekdays:
      // first import writes 1+5+10+200=216 ops; a second import over that
      // draft deletes 5+10+200=215 existing docs and writes 216 new ones =
      // 431 total, comfortably over BatchWriter's 400-op-per-batch threshold.
      const input: ImportProgrammeInput = {
        year,
        weekdaysCsv: weekdaysCsv(wdRows),
        seriesCsv: seriesCsv(seriesRows),
        singlesCsv: EMPTY_SINGLES,
      };

      const first = await importProgrammeHandler(await adminReq(input));
      expect(first.errors).toEqual([]);
      expect(first.weekdays).toBe(5);
      expect(first.series).toBe(10);
      expect(first.sessions).toBe(200);

      const firstStored = await db.collection(paths.sessions(year)).get();
      expect(firstStored.size).toBe(first.sessions);

      // Re-import the identical programme over the draft it just created.
      // Same session ids -> wouldRemoveSessions is 0 and no warning is
      // emitted, so this looks like a no-op from the report alone -- but it
      // still takes the delete-everything-then-recreate path internally.
      const second = await importProgrammeHandler(await adminReq(input));
      expect(second.errors).toEqual([]);
      expect(second.wouldRemoveSessions).toBe(0);
      expect(second.sessions).toBe(200);

      const secondStored = await db.collection(paths.sessions(year)).get();
      expect(secondStored.size).toBe(second.sessions); // <- this is the invariant the bug broke
    },
  );
});

/** `count` upcoming Mondays in `year`, formatted YYYY-MM-DD, verified against `weekdayOfNZ` implicitly via the app. */
function mondaysFor(year: number, count: number): string[] {
  // January 4th is a Monday in years where Jan 1 is a Thursday; rather than
  // hunt for that, just scan forward from Jan 1 for real Mondays.
  const dates: string[] = [];
  const d = new Date(Date.UTC(year, 0, 1));
  while (dates.length < count) {
    if (d.getUTCDay() === 1) {
      dates.push(d.toISOString().slice(0, 10));
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

/** `count` dates in `year` landing on `isoWeekday` (1=Monday .. 5=Friday), scanning forward from Jan 1. */
function datesForWeekday(year: number, isoWeekday: number, count: number): string[] {
  const dates: string[] = [];
  const d = new Date(Date.UTC(year, 0, 1));
  while (dates.length < count) {
    if (d.getUTCDay() === isoWeekday) {
      dates.push(d.toISOString().slice(0, 10));
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Emulator integration tests for `setBulkSoloStatus` (plan §21 B2). The pure
 * weekday/date/kind/lock filtering and the 200-session cap are covered
 * without the emulator in `../bulkSoloStatus.test.ts`; this file covers the
 * parts that need real Firestore — multiple published programme years, the
 * booked-entry skip, the solo-status upsert/clear behaviour, and audit/notify
 * on behalf.
 *
 * Every scenario here deliberately seeds sessions in distinctive far-future
 * calendar years (2095/2096 — the shared `year` zod schema caps at 2100, plan
 * §5.4) that no other test in this suite touches, and scopes
 * every `filter` to a tight `fromDate`/`toDate` bracket around exactly the
 * sessions it created — the emulator is shared across this whole test run
 * (`fileParallelism: false`), and `setBulkSoloStatus` searches *every*
 * published year, so an unscoped filter would also pick up unrelated
 * sessions seeded by other test files.
 */
import { describe, expect, it } from 'vitest';
import { paths, todayNZ, type SetBulkSoloStatusInput, type SetSoloStatusInput } from '@obc/shared';
import { db } from '../../lib/admin.js';
import {
  assertSessionPairingValid,
  fakeCallableRequest,
  makeMember,
  makeProgramme,
  notificationsFor,
} from '../../testing/fixtures.js';
import { setSoloStatusHandler } from '../entries.js';
import { respondToInviteHandler, sendInviteHandler } from '../invites.js';
import { setBulkSoloStatusHandler } from '../bulkSoloStatus.js';

async function entryFor(sessionId: string, memberId: string) {
  const snap = await db.doc(paths.entry(`${sessionId}_${memberId}`)).get();
  return snap.data();
}

describe('setBulkSoloStatus', () => {
  it('marks every matching session unavailable across two published years', async () => {
    const m = await makeMember('bulk-two-years@example.org');
    const yearA = await makeProgramme({ weekday: 'monday', dates: ['2095-03-02', '2095-03-09'] });
    const yearB = await makeProgramme({ weekday: 'monday', dates: ['2096-03-01'] });

    const input: SetBulkSoloStatusInput = {
      status: 'unavailable',
      filter: { weekdays: ['monday'], fromDate: '2095-01-01', toDate: '2096-12-31' },
    };
    const result = await setBulkSoloStatusHandler(fakeCallableRequest<SetBulkSoloStatusInput>(input, { uid: m }));

    expect(result.updated).toBe(3);
    expect(result.skipped).toEqual([]);

    for (const sessionId of [...yearA.sessionIds, ...yearB.sessionIds]) {
      const entry = await entryFor(sessionId, m);
      expect(entry).toMatchObject({ status: 'unavailable', partner: null, pairingId: null, teamId: null });
      await assertSessionPairingValid(sessionId);
    }
  });

  it('skips a booked (confirmed) entry and reports it in skipped — the booking is untouched', async () => {
    const m = await makeMember('bulk-skip-booked@example.org');
    const partner = await makeMember('bulk-skip-booked-partner@example.org');
    const prog = await makeProgramme({ weekday: 'tuesday', dates: ['2095-04-06', '2095-04-13'] });
    const [bookedSessionId, freeSessionId] = prog.sessionIds as [string, string];

    // m is confirmed (paired with `partner`) on the first session.
    const { invite } = await sendInviteHandler(
      fakeCallableRequest({ scope: 'session', year: prog.year, sessionId: bookedSessionId, toMemberId: m }, { uid: partner }),
    );
    await respondToInviteHandler(fakeCallableRequest({ inviteId: invite.id, accept: true }, { uid: m }));
    const beforeBooked = await entryFor(bookedSessionId, m);
    expect(beforeBooked?.status).toBe('confirmed');

    const input: SetBulkSoloStatusInput = {
      status: 'available',
      filter: { weekdays: ['tuesday'], fromDate: '2095-04-01', toDate: '2095-04-30' },
    };
    const result = await setBulkSoloStatusHandler(fakeCallableRequest<SetBulkSoloStatusInput>(input, { uid: m }));

    expect(result.updated).toBe(1);
    expect(result.skipped).toEqual([{ sessionId: bookedSessionId, date: '2095-04-06', reason: 'booked' }]);

    const afterBooked = await entryFor(bookedSessionId, m);
    expect(afterBooked).toEqual(beforeBooked);

    const freeEntry = await entryFor(freeSessionId, m);
    expect(freeEntry).toMatchObject({ status: 'available' });

    await assertSessionPairingValid(bookedSessionId);
    await assertSessionPairingValid(freeSessionId);
  });

  it('overwrites an existing looking_for_partner entry with unavailable', async () => {
    const m = await makeMember('bulk-overwrite-lfp@example.org');
    const prog = await makeProgramme({ weekday: 'wednesday', dates: ['2095-05-06'] });
    const sessionId = prog.sessionIds[0]!;

    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>({ year: prog.year, sessionId, status: 'looking_for_partner' }, { uid: m }),
    );
    expect((await entryFor(sessionId, m))?.status).toBe('looking_for_partner');

    const input: SetBulkSoloStatusInput = {
      status: 'unavailable',
      filter: { weekdays: ['wednesday'], fromDate: '2095-05-01', toDate: '2095-05-31' },
    };
    const result = await setBulkSoloStatusHandler(fakeCallableRequest<SetBulkSoloStatusInput>(input, { uid: m }));

    expect(result.updated).toBe(1);
    const entry = await entryFor(sessionId, m);
    expect(entry).toMatchObject({ status: 'unavailable', partner: null, pairingId: null });
  });

  it("'clear' cancels an existing unavailable entry", async () => {
    const m = await makeMember('bulk-clear-unavail@example.org');
    const prog = await makeProgramme({ weekday: 'thursday', dates: ['2095-06-04'] });
    const sessionId = prog.sessionIds[0]!;

    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>({ year: prog.year, sessionId, status: 'unavailable' }, { uid: m }),
    );

    const input: SetBulkSoloStatusInput = {
      status: 'clear',
      filter: { weekdays: ['thursday'], fromDate: '2095-06-01', toDate: '2095-06-30' },
    };
    const result = await setBulkSoloStatusHandler(fakeCallableRequest<SetBulkSoloStatusInput>(input, { uid: m }));

    expect(result.updated).toBe(1);
    expect((await entryFor(sessionId, m))?.status).toBe('cancelled');
  });

  it("'clear' on a session with no entry is a no-op", async () => {
    const m = await makeMember('bulk-clear-noop@example.org');
    const prog = await makeProgramme({ weekday: 'friday', dates: ['2095-07-03'] });
    const sessionId = prog.sessionIds[0]!;

    const input: SetBulkSoloStatusInput = {
      status: 'clear',
      filter: { weekdays: ['friday'], fromDate: '2095-07-01', toDate: '2095-07-31' },
    };
    const result = await setBulkSoloStatusHandler(fakeCallableRequest<SetBulkSoloStatusInput>(input, { uid: m }));

    expect(result.updated).toBe(0);
    expect(result.skipped).toEqual([]);
    expect(await entryFor(sessionId, m)).toBeUndefined();
  });

  it('excludes a noBridge session and one outside the date range', async () => {
    const m = await makeMember('bulk-excludes-nobridge@example.org');
    const prog = await makeProgramme({ weekday: 'monday', dates: ['2095-08-03'] });
    const inRangeId = prog.sessionIds[0]!;

    const now = new Date().toISOString();
    const noBridgeId = `${prog.year}-bulk-nobridge-test`;
    await db.doc(paths.session(prog.year, noBridgeId)).set({
      id: noBridgeId,
      date: '2095-08-10',
      weekday: 'monday',
      seriesId: null,
      kind: 'noBridge',
      title: 'Public holiday',
      partnerRequired: false,
      createdAt: now,
      updatedAt: now,
    });
    const outOfRangeId = `${prog.year}-bulk-outofrange-test`;
    await db.doc(paths.session(prog.year, outOfRangeId)).set({
      id: outOfRangeId,
      date: '2095-09-01',
      weekday: 'monday',
      seriesId: null,
      kind: 'series',
      title: 'Out of range',
      partnerRequired: true,
      createdAt: now,
      updatedAt: now,
    });

    const input: SetBulkSoloStatusInput = {
      status: 'unavailable',
      filter: { weekdays: ['monday'], fromDate: '2095-08-01', toDate: '2095-08-31' },
    };
    const result = await setBulkSoloStatusHandler(fakeCallableRequest<SetBulkSoloStatusInput>(input, { uid: m }));

    expect(result.updated).toBe(1);
    expect((await entryFor(inRangeId, m))?.status).toBe('unavailable');
    expect(await entryFor(noBridgeId, m)).toBeUndefined();
    expect(await entryFor(outOfRangeId, m)).toBeUndefined();
  });

  it('excludes a locked (already-started) session dated today', async () => {
    const m = await makeMember('bulk-excludes-locked@example.org');
    const today = todayNZ();
    // A fresh, distinctive weekday/series combo dated *today* with a start
    // time that has already passed (00:01) — always locked, regardless of
    // what time this test happens to run.
    const prog = await makeProgramme({
      weekday: 'tuesday',
      startTime: '00:01',
      seatedByTime: '00:00',
      seriesName: 'Bulk Locked Today Test',
      dates: [today],
    });
    const sessionId = prog.sessionIds[0]!;

    const input: SetBulkSoloStatusInput = {
      status: 'unavailable',
      filter: { weekdays: ['tuesday'], fromDate: today, toDate: today },
    };
    const result = await setBulkSoloStatusHandler(fakeCallableRequest<SetBulkSoloStatusInput>(input, { uid: m }));

    expect(result.updated).toBe(0);
    expect(result.skipped).toEqual([]);
    expect(await entryFor(sessionId, m)).toBeUndefined();
  });

  it('on-behalf: admin bulk-sets a member and the target is audited and notified', async () => {
    const admin = await makeMember('bulk-onbehalf-admin@example.org', { role: 'admin' });
    const m = await makeMember('bulk-onbehalf-member@example.org');
    const prog = await makeProgramme({ weekday: 'monday', dates: ['2095-10-05'] });
    const sessionId = prog.sessionIds[0]!;

    const input: SetBulkSoloStatusInput = {
      status: 'unavailable',
      filter: { weekdays: ['monday'], fromDate: '2095-10-01', toDate: '2095-10-31' },
      onBehalfOfMemberId: m,
    };
    const result = await setBulkSoloStatusHandler(fakeCallableRequest<SetBulkSoloStatusInput>(input, { uid: admin }));

    expect(result.updated).toBe(1);
    expect((await entryFor(sessionId, m))?.status).toBe('unavailable');

    const auditSnap = await db.collection(paths.auditLog()).where('action', '==', 'set_bulk_solo_status_on_behalf').get();
    expect(auditSnap.docs.some((d) => d.data().actorMemberId === admin && d.data().targetMemberId === m)).toBe(true);
    expect(await notificationsFor(m, 'on_behalf_action')).toHaveLength(1);
  });
});

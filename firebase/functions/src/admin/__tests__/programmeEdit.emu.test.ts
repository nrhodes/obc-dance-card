import { describe, expect, it } from 'vitest';
import {
  paths,
  type RespondToInviteInput,
  type SendInviteInput,
  type Series,
  type Session,
  type UpdateSeriesInput,
  type UpdateSessionInput,
  type UpdateWeekdayInput,
  type WeekdayProgramme,
} from '@obc/shared';
import { db } from '../../lib/admin.js';
import { fakeCallableRequest, makeMember, makeProgramme, notificationsFor, sessionInFuture } from '../../testing/fixtures.js';
import { sendInviteHandler, respondToInviteHandler } from '../../entries/invites.js';
import { updateSeriesHandler, updateSessionHandler, updateWeekdayHandler } from '../programmeEdit.js';

describe('updateSeries', () => {
  it('renames a series and propagates the name onto its sessions', async () => {
    const admin = await makeMember('upser-rename-admin@example.org', { role: 'admin' });
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    const result = await updateSeriesHandler(
      fakeCallableRequest<UpdateSeriesInput>(
        { year: prog.year, seriesId: prog.seriesId, patch: { name: 'Renamed Pairs' } },
        { uid: admin },
      ),
    );
    expect(result.series.name).toBe('Renamed Pairs');

    const session = (await db.doc(paths.session(prog.year, prog.sessionIds[0]!)).get()).data() as Session;
    expect(session.seriesName).toBe('Renamed Pairs');
    expect(session.title).toBe('Renamed Pairs');
  });

  it('refuses a format change while the series has non-cancelled entries', async () => {
    const admin = await makeMember('upser-format-admin@example.org', { role: 'admin' });
    const a = await makeMember('upser-format-a@example.org');
    const b = await makeMember('upser-format-b@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    const { invite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>({ scope: 'session', year: prog.year, sessionId: prog.sessionIds[0]!, toMemberId: b }, { uid: a }),
    );
    await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.id, accept: true }, { uid: b }));

    await expect(
      updateSeriesHandler(
        fakeCallableRequest<UpdateSeriesInput>(
          { year: prog.year, seriesId: prog.seriesId, patch: { format: 'Individual' } },
          { uid: admin },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('allows updating teamMax and validates bestOf shape', async () => {
    const admin = await makeMember('upser-teammax-admin@example.org', { role: 'admin' });
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInFuture('monday')] });

    const result = await updateSeriesHandler(
      fakeCallableRequest<UpdateSeriesInput>(
        { year: prog.year, seriesId: prog.seriesId, patch: { teamMax: 8 } },
        { uid: admin },
      ),
    );
    expect(result.series.teamMax).toBe(8);

    await expect(
      updateSeriesHandler(
        fakeCallableRequest<UpdateSeriesInput>(
          { year: prog.year, seriesId: prog.seriesId, patch: { bestOf: { n: 5, m: 3 } } },
          { uid: admin },
        ),
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('notifies members with a future entry in the series', async () => {
    const admin = await makeMember('upser-notify-admin@example.org', { role: 'admin' });
    const a = await makeMember('upser-notify-a@example.org');
    const b = await makeMember('upser-notify-b@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const { invite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>({ scope: 'session', year: prog.year, sessionId: prog.sessionIds[0]!, toMemberId: b }, { uid: a }),
    );
    await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.id, accept: true }, { uid: b }));

    await updateSeriesHandler(
      fakeCallableRequest<UpdateSeriesInput>(
        { year: prog.year, seriesId: prog.seriesId, patch: { generalNote: 'note updated' } },
        { uid: admin },
      ),
    );

    expect(await notificationsFor(a, 'programme_changed')).toHaveLength(1);
    expect(await notificationsFor(b, 'programme_changed')).toHaveLength(1);
  });
});

describe('updateSession', () => {
  it('refuses a date move while the session has non-cancelled entries', async () => {
    const admin = await makeMember('upsess-datebusy-admin@example.org', { role: 'admin' });
    const a = await makeMember('upsess-datebusy-a@example.org');
    const b = await makeMember('upsess-datebusy-b@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const { invite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>({ scope: 'session', year: prog.year, sessionId: prog.sessionIds[0]!, toMemberId: b }, { uid: a }),
    );
    await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.id, accept: true }, { uid: b }));

    const newDate = sessionInFuture('monday', 401);
    await expect(
      updateSessionHandler(
        fakeCallableRequest<UpdateSessionInput>(
          { year: prog.year, sessionId: prog.sessionIds[0]!, patch: { date: newDate } },
          { uid: admin },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('moves a session date when nothing is entered: old id gone, new id present, series.sessionIds updated', async () => {
    const admin = await makeMember('upsess-datemove-admin@example.org', { role: 'admin' });
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const oldSessionId = prog.sessionIds[0]!;
    const newDate = sessionInFuture('monday', 402);

    const result = await updateSessionHandler(
      fakeCallableRequest<UpdateSessionInput>({ year: prog.year, sessionId: oldSessionId, patch: { date: newDate } }, { uid: admin }),
    );
    expect(result.removed).toBe(false);
    expect(result.session?.date).toBe(newDate);
    const newSessionId = result.session!.id;
    expect(newSessionId).not.toBe(oldSessionId);

    const oldDoc = await db.doc(paths.session(prog.year, oldSessionId)).get();
    expect(oldDoc.exists).toBe(false);
    const newDoc = await db.doc(paths.session(prog.year, newSessionId)).get();
    expect(newDoc.exists).toBe(true);

    const series = (await db.doc(paths.seriesDoc(prog.year, prog.seriesId)).get()).data() as Series;
    expect(series.sessionIds).not.toContain(oldSessionId);
    expect(series.sessionIds).toContain(newSessionId);
  });

  it('refuses a date move onto a weekday mismatch', async () => {
    const admin = await makeMember('upsess-weekday-admin@example.org', { role: 'admin' });
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const tuesdayDate = sessionInFuture('tuesday', 403);

    await expect(
      updateSessionHandler(
        fakeCallableRequest<UpdateSessionInput>(
          { year: prog.year, sessionId: prog.sessionIds[0]!, patch: { date: tuesdayDate } },
          { uid: admin },
        ),
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('remove: true cascades entry cancellation, expires invites, deletes the session, and notifies', async () => {
    const admin = await makeMember('upsess-remove-admin@example.org', { role: 'admin' });
    const a = await makeMember('upsess-remove-a@example.org');
    const b = await makeMember('upsess-remove-b@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const { invite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>({ scope: 'session', year: prog.year, sessionId: prog.sessionIds[0]!, toMemberId: b }, { uid: a }),
    );
    await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.id, accept: true }, { uid: b }));

    const result = await updateSessionHandler(
      fakeCallableRequest<UpdateSessionInput>({ year: prog.year, sessionId: prog.sessionIds[0]!, patch: { remove: true } }, { uid: admin }),
    );
    expect(result.removed).toBe(true);
    expect(result.session).toBeNull();

    // Which of a/b's entry the removal cascade happens to process first is
    // an implementation detail of Firestore's unordered query result order —
    // exactly one side ends up told "your partner cancelled" via the shared
    // cascade, and *both* get the "this session was removed" notice
    // regardless of order.
    const [notifA, notifB] = await Promise.all([
      notificationsFor(a, 'partner_cancelled'),
      notificationsFor(b, 'partner_cancelled'),
    ]);
    expect(notifA.length + notifB.length).toBe(1);
    expect(await notificationsFor(a, 'programme_changed')).toHaveLength(1);
    expect(await notificationsFor(b, 'programme_changed')).toHaveLength(1);

    const sessionDoc = await db.doc(paths.session(prog.year, prog.sessionIds[0]!)).get();
    expect(sessionDoc.exists).toBe(false);

    const series = (await db.doc(paths.seriesDoc(prog.year, prog.seriesId)).get()).data() as Series;
    expect(series.sessionIds).not.toContain(prog.sessionIds[0]);
  });
});

describe('updateWeekday', () => {
  it('applies a partial update, leaving unset fields untouched', async () => {
    const admin = await makeMember('upwd-partial-admin@example.org', { role: 'admin' });
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    const result = await updateWeekdayHandler(
      fakeCallableRequest<UpdateWeekdayInput>(
        { year: prog.year, weekday: prog.weekday, patch: { label: 'Monday Social' } },
        { uid: admin },
      ),
    );
    expect(result.weekday.label).toBe('Monday Social');
    expect(result.weekday.startTime).toBe('13:00');
    expect(result.weekday.seatedByTime).toBe('12:45');
  });

  it('sets a partner steward, then clears it with null', async () => {
    const admin = await makeMember('upwd-steward-admin@example.org', { role: 'admin' });
    const steward = await makeMember('upwd-steward-target@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    const set = await updateWeekdayHandler(
      fakeCallableRequest<UpdateWeekdayInput>(
        { year: prog.year, weekday: prog.weekday, patch: { partnerStewardMemberId: steward } },
        { uid: admin },
      ),
    );
    expect(set.weekday.partnerStewardMemberId).toBe(steward);

    const cleared = await updateWeekdayHandler(
      fakeCallableRequest<UpdateWeekdayInput>(
        { year: prog.year, weekday: prog.weekday, patch: { partnerStewardMemberId: null } },
        { uid: admin },
      ),
    );
    expect(cleared.weekday.partnerStewardMemberId).toBeUndefined();

    const doc = (await db.doc(paths.weekday(prog.year, prog.weekday)).get()).data() as WeekdayProgramme;
    expect(doc.partnerStewardMemberId).toBeUndefined();
  });

  it('rejects an inactive member as steward', async () => {
    const admin = await makeMember('upwd-inactive-admin@example.org', { role: 'admin' });
    const inactive = await makeMember('upwd-inactive-target@example.org', { active: false });
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    await expect(
      updateWeekdayHandler(
        fakeCallableRequest<UpdateWeekdayInput>(
          { year: prog.year, weekday: prog.weekday, patch: { partnerStewardMemberId: inactive } },
          { uid: admin },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects an unknown member as steward', async () => {
    const admin = await makeMember('upwd-unknown-admin@example.org', { role: 'admin' });
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    await expect(
      updateWeekdayHandler(
        fakeCallableRequest<UpdateWeekdayInput>(
          { year: prog.year, weekday: prog.weekday, patch: { partnerStewardMemberId: 'no-such-member' } },
          { uid: admin },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects an unknown weekday', async () => {
    const admin = await makeMember('upwd-noweekday-admin@example.org', { role: 'admin' });
    // A programme far enough in the future (~17 years) that no other emu
    // fixture's `sessionInFuture`/hard-coded-year programme could also have
    // created a `tuesday` weekday doc for this same year — the shared
    // emulator accumulates state across every test file in the run (see
    // `misc.emu.test.ts`'s note on member counts), and both `misc` and
    // `members` emu suites create a real `tuesday` weekday doc via
    // `sessionInFuture('tuesday')` at the *default* offset, which lands in
    // the same year as `sessionInFuture('monday')` used elsewhere.
    const prog = await makeProgramme({ dates: [sessionInFuture('monday', 900)] });

    await expect(
      updateWeekdayHandler(
        fakeCallableRequest<UpdateWeekdayInput>(
          { year: prog.year, weekday: 'tuesday', patch: { label: 'Nope' } },
          { uid: admin },
        ),
      ),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('rejects an unknown year', async () => {
    const admin = await makeMember('upwd-noyear-admin@example.org', { role: 'admin' });

    await expect(
      updateWeekdayHandler(
        fakeCallableRequest<UpdateWeekdayInput>(
          { year: 2091, weekday: 'monday', patch: { label: 'Nope' } },
          { uid: admin },
        ),
      ),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('is refused for a non-admin', async () => {
    const member = await makeMember('upwd-nonadmin-member@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    await expect(
      updateWeekdayHandler(
        fakeCallableRequest<UpdateWeekdayInput>(
          { year: prog.year, weekday: prog.weekday, patch: { label: 'Nope' } },
          { uid: member },
        ),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('writes a programme_edit audit row', async () => {
    const admin = await makeMember('upwd-audit-admin@example.org', { role: 'admin' });
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    await updateWeekdayHandler(
      fakeCallableRequest<UpdateWeekdayInput>(
        { year: prog.year, weekday: prog.weekday, patch: { notes: 'Audited note' } },
        { uid: admin },
      ),
    );

    const snap = await db.collection(paths.auditLog()).where('action', '==', 'programme_edit').get();
    const row = snap.docs.find(
      (d) => d.data().actorMemberId === admin && d.data().entityRef === paths.weekday(prog.year, prog.weekday),
    );
    expect(row?.data().detail).toMatchObject({ year: prog.year, weekday: prog.weekday });
  });
});

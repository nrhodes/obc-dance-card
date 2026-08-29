import { describe, expect, it } from 'vitest';
import {
  paths,
  type RespondToInviteInput,
  type SendInviteInput,
  type Series,
  type Session,
  type UpdateSeriesInput,
  type UpdateSessionInput,
} from '@obc/shared';
import { db } from '../../lib/admin.js';
import { fakeCallableRequest, makeMember, makeProgramme, notificationsFor, sessionInFuture } from '../../testing/fixtures.js';
import { sendInviteHandler, respondToInviteHandler } from '../../entries/invites.js';
import { updateSeriesHandler, updateSessionHandler } from '../programmeEdit.js';

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

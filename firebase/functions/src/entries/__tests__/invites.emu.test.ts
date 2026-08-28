import { describe, expect, it } from 'vitest';
import type {
  Invite,
  RespondToInviteInput,
  SendInviteInput,
  CancelInviteInput,
  SetSoloStatusInput,
} from '@obc/shared';
import { paths } from '@obc/shared';
import { db } from '../../lib/admin.js';
import {
  assertSessionPairingValid,
  entriesForSession,
  fakeCallableRequest,
  makeMember,
  makeProgramme,
  notificationsFor,
  sessionInFuture,
  sessionInPast,
} from '../../testing/fixtures.js';
import { setSoloStatusHandler } from '../entries.js';
import { cancelInviteHandler, respondToInviteHandler, sendInviteHandler } from '../invites.js';

describe('sendInvite', () => {
  it('creates a pending invite and notifies the invitee', async () => {
    const a = await makeMember('invite-a@example.org');
    const b = await makeMember('invite-b@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    const result = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0], toMemberId: b },
        { uid: a },
      ),
    );

    expect(result.invite.status).toBe('pending');
    expect(result.invite.fromMemberId).toBe(a);
    expect(result.invite.toMemberId).toBe(b);
    expect(result.invite.sessionIds).toEqual([prog.sessionIds[0]]);

    const notifications = await notificationsFor(b, 'invite_received');
    expect(notifications).toHaveLength(1);
    await assertSessionPairingValid(prog.sessionIds[0]!);
  });

  it('rejects inviting yourself', async () => {
    const a = await makeMember('invite-self@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    await expect(
      sendInviteHandler(
        fakeCallableRequest<SendInviteInput>(
          { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0], toMemberId: a },
          { uid: a },
        ),
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects inviting an inactive member', async () => {
    const a = await makeMember('invite-active@example.org');
    const b = await makeMember('invite-inactive@example.org', { active: false });
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    await expect(
      sendInviteHandler(
        fakeCallableRequest<SendInviteInput>(
          { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0], toMemberId: b },
          { uid: a },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects a duplicate pending invite to the same member for an overlapping session', async () => {
    const a = await makeMember('invite-dupa@example.org');
    const b = await makeMember('invite-dupb@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const input: SendInviteInput = { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0], toMemberId: b };

    await sendInviteHandler(fakeCallableRequest<SendInviteInput>(input, { uid: a }));
    await expect(sendInviteHandler(fakeCallableRequest<SendInviteInput>(input, { uid: a }))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('rejects when the sender is already paired for that session', async () => {
    const a = await makeMember('invite-busy-a@example.org');
    const b = await makeMember('invite-busy-b@example.org');
    const c = await makeMember('invite-busy-c@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    // a and b already paired.
    await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0], toMemberId: b },
        { uid: a },
      ),
    );
    const invites = await db.collection(paths.invites()).where('fromMemberId', '==', a).get();
    const inviteId = invites.docs[0]!.id;
    await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId, accept: true }, { uid: b }));

    // a tries to invite c while already paired with b.
    await expect(
      sendInviteHandler(
        fakeCallableRequest<SendInviteInput>(
          { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0], toMemberId: c },
          { uid: a },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('series scope invites every unlocked session and silently excludes a locked one', async () => {
    const a = await makeMember('invite-series-a@example.org');
    const b = await makeMember('invite-series-b@example.org');
    const prog = await makeProgramme({
      seriesName: 'Series Invite Test',
      dates: [sessionInPast('monday', 1), sessionInFuture('monday', 3), sessionInFuture('monday', 5)],
    });

    const result = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'series', year: prog.year, seriesId: prog.seriesId, toMemberId: b },
        { uid: a },
      ),
    );

    expect(result.invite.sessionIds).toHaveLength(2);
    expect(result.invite.sessionIds).not.toContain(prog.sessionIds[0]);
    expect(result.invite.sessionIds).toEqual([prog.sessionIds[1], prog.sessionIds[2]]);
  });

  it('rejects the 31st invite in a day with resource-exhausted', async () => {
    const a = await makeMember('invite-rate@example.org');
    const prog = await makeProgramme({
      dates: Array.from({ length: 32 }, (_, i) => sessionInFuture('monday', 4 + i)),
    });

    for (let i = 0; i < 30; i++) {
      const to = await makeMember(`invite-rate-to-${i}@example.org`);
      await sendInviteHandler(
        fakeCallableRequest<SendInviteInput>(
          { scope: 'session', year: prog.year, sessionId: prog.sessionIds[i], toMemberId: to },
          { uid: a },
        ),
      );
    }

    const overflowTo = await makeMember('invite-rate-overflow@example.org');
    await expect(
      sendInviteHandler(
        fakeCallableRequest<SendInviteInput>(
          { scope: 'session', year: prog.year, sessionId: prog.sessionIds[30], toMemberId: overflowTo },
          { uid: a },
        ),
      ),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
  });
});

describe('respondToInvite', () => {
  it('accept creates two mirrored entries and notifies the sender', async () => {
    const a = await makeMember('respond-a@example.org');
    const b = await makeMember('respond-b@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    const { invite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0], toMemberId: b },
        { uid: a },
      ),
    );

    const result = await respondToInviteHandler(
      fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.id, accept: true }, { uid: b }),
    );

    expect(result.invite.status).toBe('accepted');
    expect(result.entries).toHaveLength(2);
    const entries = await assertSessionPairingValid(prog.sessionIds[0]!);
    expect(entries.filter((e) => e.status === 'confirmed')).toHaveLength(2);

    const notifications = await notificationsFor(a, 'invite_accepted');
    expect(notifications).toHaveLength(1);
  });

  it('expires other pending invites to either member for the same session and notifies their senders', async () => {
    const a = await makeMember('respond-exp-a@example.org');
    const b = await makeMember('respond-exp-b@example.org');
    const c = await makeMember('respond-exp-c@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    const { invite: inviteAB } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0], toMemberId: b },
        { uid: a },
      ),
    );
    const { invite: inviteCB } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0], toMemberId: b },
        { uid: c },
      ),
    );

    await respondToInviteHandler(
      fakeCallableRequest<RespondToInviteInput>({ inviteId: inviteAB.id, accept: true }, { uid: b }),
    );

    const otherSnap = await db.doc(paths.invite(inviteCB.id)).get();
    expect((otherSnap.data() as Invite).status).toBe('expired');

    const expiredNotifications = await notificationsFor(c, 'invite_expired');
    expect(expiredNotifications).toHaveLength(1);
  });

  it('decline sets status=declined and notifies the sender', async () => {
    const a = await makeMember('respond-decline-a@example.org');
    const b = await makeMember('respond-decline-b@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    const { invite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0], toMemberId: b },
        { uid: a },
      ),
    );
    const result = await respondToInviteHandler(
      fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.id, accept: false }, { uid: b }),
    );
    expect(result.invite.status).toBe('declined');
    expect(result.entries).toEqual([]);
    expect(await notificationsFor(a, 'invite_declined')).toHaveLength(1);
  });

  it('rejects accept by someone other than the invitee', async () => {
    const a = await makeMember('respond-wrong-a@example.org');
    const b = await makeMember('respond-wrong-b@example.org');
    const c = await makeMember('respond-wrong-c@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    const { invite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0], toMemberId: b },
        { uid: a },
      ),
    );

    await expect(
      respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.id, accept: true }, { uid: c })),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('fails atomically, leaving the invite pending, when the invitee got paired elsewhere meanwhile', async () => {
    const a = await makeMember('respond-race-a@example.org');
    const b = await makeMember('respond-race-b@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    const { invite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0], toMemberId: b },
        { uid: a },
      ),
    );

    // b takes themselves off the market on this session in the meantime, by some
    // means unrelated to this invite (any non-free entry triggers the same check).
    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>(
        { year: prog.year, sessionId: prog.sessionIds[0]!, status: 'available' },
        { uid: b },
      ),
    );

    await expect(
      respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.id, accept: true }, { uid: b })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    const snap = await db.doc(paths.invite(invite.id)).get();
    expect((snap.data() as Invite).status).toBe('pending');

    await assertSessionPairingValid(prog.sessionIds[0]!);
  });

  it('series accept with one conflicting session fails atomically — no entries written', async () => {
    const a = await makeMember('respond-series-a@example.org');
    const b = await makeMember('respond-series-b@example.org');
    const prog = await makeProgramme({
      seriesName: 'Series Conflict Test',
      dates: [sessionInFuture('monday', 3), sessionInFuture('monday', 5)],
    });

    const { invite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'series', year: prog.year, seriesId: prog.seriesId, toMemberId: b },
        { uid: a },
      ),
    );

    // b is busy on the second session only, unrelated to this invite.
    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>(
        { year: prog.year, sessionId: prog.sessionIds[1]!, status: 'available' },
        { uid: b },
      ),
    );

    await expect(
      respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.id, accept: true }, { uid: b })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    const firstSessionEntries = await entriesForSession(prog.sessionIds[0]!);
    expect(firstSessionEntries.filter((e) => e.status !== 'cancelled')).toHaveLength(0);

    const stillPending = await db.doc(paths.invite(invite.id)).get();
    expect((stillPending.data() as Invite).status).toBe('pending');
  });

  it('an expired invite cannot be accepted and is marked expired', async () => {
    const a = await makeMember('respond-expired-a@example.org');
    const b = await makeMember('respond-expired-b@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    const { invite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0], toMemberId: b },
        { uid: a },
      ),
    );
    // Force it into the past.
    await db.doc(paths.invite(invite.id)).set({ expiresAt: '2000-01-01T00:00:00.000Z' }, { merge: true });

    await expect(
      respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.id, accept: true }, { uid: b })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    const snap = await db.doc(paths.invite(invite.id)).get();
    expect((snap.data() as Invite).status).toBe('expired');
  });
});

describe('cancelInvite', () => {
  it('cancels a pending invite and notifies the invitee', async () => {
    const a = await makeMember('cancel-invite-a@example.org');
    const b = await makeMember('cancel-invite-b@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    const { invite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0], toMemberId: b },
        { uid: a },
      ),
    );

    const result = await cancelInviteHandler(fakeCallableRequest<CancelInviteInput>({ inviteId: invite.id }, { uid: a }));
    expect(result.invite.status).toBe('cancelled');
    expect(await notificationsFor(b, 'invite_cancelled')).toHaveLength(1);
  });

  it('rejects cancelling someone else’s invite', async () => {
    const a = await makeMember('cancel-invite-wrong-a@example.org');
    const b = await makeMember('cancel-invite-wrong-b@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    const { invite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0], toMemberId: b },
        { uid: a },
      ),
    );

    await expect(
      cancelInviteHandler(fakeCallableRequest<CancelInviteInput>({ inviteId: invite.id }, { uid: b })),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('respondToInvite concurrency', () => {
  it('two invites to the same member for the same session: exactly one accept succeeds', async () => {
    const poster = await makeMember('concurrency-poster@example.org');
    const suitorOne = await makeMember('concurrency-suitor1@example.org');
    const suitorTwo = await makeMember('concurrency-suitor2@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    const { invite: inviteOne } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0], toMemberId: poster },
        { uid: suitorOne },
      ),
    );
    const { invite: inviteTwo } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0], toMemberId: poster },
        { uid: suitorTwo },
      ),
    );

    const results = await Promise.allSettled([
      respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: inviteOne.id, accept: true }, { uid: poster })),
      respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: inviteTwo.id, accept: true }, { uid: poster })),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);

    await assertSessionPairingValid(prog.sessionIds[0]!);
  });
});


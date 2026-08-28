import { describe, expect, it } from 'vitest';
import type {
  ClaimLookingForPartnerInput,
  ClearSoloStatusInput,
  RespondToInviteInput,
  SendInviteInput,
  SetSoloStatusInput,
} from '@obc/shared';
import { db } from '../../lib/admin.js';
import {
  assertSessionPairingValid,
  fakeCallableRequest,
  makeMember,
  makeProgramme,
  notificationsFor,
  sessionInFuture,
  sessionInPast,
} from '../../testing/fixtures.js';
import { paths } from '@obc/shared';
import {
  claimLookingForPartnerHandler,
  clearSoloStatusHandler,
  setSoloStatusHandler,
} from '../entries.js';
import { respondToInviteHandler, sendInviteHandler } from '../invites.js';

describe('setSoloStatus / clearSoloStatus', () => {
  it('creates a looking_for_partner entry', async () => {
    const m = await makeMember('solo-lfp@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    const { entry } = await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>(
        { year: prog.year, sessionId: prog.sessionIds[0]!, status: 'looking_for_partner' },
        { uid: m },
      ),
    );

    expect(entry.status).toBe('looking_for_partner');
    expect(entry.partner).toBeNull();
    expect(entry.pairingId).toBeNull();
    await assertSessionPairingValid(prog.sessionIds[0]!);
  });

  it('switches between looking_for_partner and available in place (same doc id)', async () => {
    const m = await makeMember('solo-switch@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const input = { year: prog.year, sessionId: prog.sessionIds[0]!, onBehalfOfMemberId: undefined };

    const first = await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>({ ...input, status: 'looking_for_partner' }, { uid: m }),
    );

    // Clear, then re-set as 'available' — must reuse the same deterministic doc id.
    await clearSoloStatusHandler(fakeCallableRequest<ClearSoloStatusInput>({ year: prog.year, sessionId: prog.sessionIds[0]! }, { uid: m }));
    const second = await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>({ ...input, status: 'available' }, { uid: m }),
    );

    expect(second.entry.id).toBe(first.entry.id);
    expect(second.entry.status).toBe('available');
    await assertSessionPairingValid(prog.sessionIds[0]!);
  });

  it('clear sets status to cancelled', async () => {
    const m = await makeMember('solo-clear@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>(
        { year: prog.year, sessionId: prog.sessionIds[0]!, status: 'available' },
        { uid: m },
      ),
    );

    const { entry } = await clearSoloStatusHandler(
      fakeCallableRequest<ClearSoloStatusInput>({ year: prog.year, sessionId: prog.sessionIds[0]! }, { uid: m }),
    );
    expect(entry.status).toBe('cancelled');
  });

  it('re-setting after clear reuses the same doc id', async () => {
    const m = await makeMember('solo-reuse@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    const first = await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>(
        { year: prog.year, sessionId: prog.sessionIds[0]!, status: 'looking_for_partner' },
        { uid: m },
      ),
    );
    await clearSoloStatusHandler(fakeCallableRequest<ClearSoloStatusInput>({ year: prog.year, sessionId: prog.sessionIds[0]! }, { uid: m }));
    const second = await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>(
        { year: prog.year, sessionId: prog.sessionIds[0]!, status: 'looking_for_partner' },
        { uid: m },
      ),
    );

    expect(second.entry.id).toBe(first.entry.id);
  });

  it('rejects on a Teams session', async () => {
    const m = await makeMember('solo-teams@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInFuture('monday')] });

    await expect(
      setSoloStatusHandler(
        fakeCallableRequest<SetSoloStatusInput>(
          { year: prog.year, sessionId: prog.sessionIds[0]!, status: 'looking_for_partner' },
          { uid: m },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects on a locked session', async () => {
    const m = await makeMember('solo-locked@example.org');
    const prog = await makeProgramme({ dates: [sessionInPast('monday')] });

    await expect(
      setSoloStatusHandler(
        fakeCallableRequest<SetSoloStatusInput>(
          { year: prog.year, sessionId: prog.sessionIds[0]!, status: 'looking_for_partner' },
          { uid: m },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('admin force on a locked session succeeds and is audited', async () => {
    const admin = await makeMember('solo-admin@example.org', { role: 'admin' });
    const m = await makeMember('solo-onbehalf@example.org');
    const prog = await makeProgramme({ dates: [sessionInPast('monday')] });

    const { entry } = await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>(
        {
          year: prog.year,
          sessionId: prog.sessionIds[0]!,
          status: 'looking_for_partner',
          onBehalfOfMemberId: m,
          force: true,
        },
        { uid: admin },
      ),
    );
    expect(entry.status).toBe('looking_for_partner');

    const auditSnap = await db.collection(paths.auditLog()).where('action', '==', 'set_solo_status_on_behalf').get();
    expect(auditSnap.docs.some((d) => d.data().actorMemberId === admin && d.data().targetMemberId === m)).toBe(true);

    expect(await notificationsFor(m, 'on_behalf_action')).toHaveLength(1);
  });

  it('a non-admin passing force is rejected', async () => {
    const m = await makeMember('solo-force-denied@example.org');
    const prog = await makeProgramme({ dates: [sessionInPast('monday')] });

    await expect(
      setSoloStatusHandler(
        fakeCallableRequest<SetSoloStatusInput>(
          { year: prog.year, sessionId: prog.sessionIds[0]!, status: 'looking_for_partner', force: true },
          { uid: m },
        ),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('claimLookingForPartner', () => {
  it('happy path pairs poster and claimer and notifies the poster', async () => {
    const poster = await makeMember('claim-poster@example.org');
    const claimer = await makeMember('claim-claimer@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>(
        { year: prog.year, sessionId: prog.sessionIds[0]!, status: 'looking_for_partner' },
        { uid: poster },
      ),
    );

    const result = await claimLookingForPartnerHandler(
      fakeCallableRequest<ClaimLookingForPartnerInput>(
        { year: prog.year, sessionId: prog.sessionIds[0]!, posterMemberId: poster },
        { uid: claimer },
      ),
    );

    expect(result.entries).toHaveLength(2);
    expect(result.entries.every((e) => e.status === 'confirmed')).toBe(true);
    await assertSessionPairingValid(prog.sessionIds[0]!);
    expect(await notificationsFor(poster, 'claimed')).toHaveLength(1);
  });

  it('rejects claiming a poster who is only "available", not "looking_for_partner"', async () => {
    const poster = await makeMember('claim-available-poster@example.org');
    const claimer = await makeMember('claim-available-claimer@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>(
        { year: prog.year, sessionId: prog.sessionIds[0]!, status: 'available' },
        { uid: poster },
      ),
    );

    await expect(
      claimLookingForPartnerHandler(
        fakeCallableRequest<ClaimLookingForPartnerInput>(
          { year: prog.year, sessionId: prog.sessionIds[0]!, posterMemberId: poster },
          { uid: claimer },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects a claimer who is already busy on that session', async () => {
    const poster = await makeMember('claim-busy-poster@example.org');
    const claimer = await makeMember('claim-busy-claimer@example.org');
    const someoneElse = await makeMember('claim-busy-other@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>(
        { year: prog.year, sessionId: prog.sessionIds[0]!, status: 'looking_for_partner' },
        { uid: poster },
      ),
    );
    const { invite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0]!, toMemberId: claimer },
        { uid: someoneElse },
      ),
    );
    await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.id, accept: true }, { uid: claimer }));

    await expect(
      claimLookingForPartnerHandler(
        fakeCallableRequest<ClaimLookingForPartnerInput>(
          { year: prog.year, sessionId: prog.sessionIds[0]!, posterMemberId: poster },
          { uid: claimer },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects claiming a Teams session', async () => {
    const poster = await makeMember('claim-teams-poster@example.org');
    const claimer = await makeMember('claim-teams-claimer@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInFuture('monday')] });

    await expect(
      claimLookingForPartnerHandler(
        fakeCallableRequest<ClaimLookingForPartnerInput>(
          { year: prog.year, sessionId: prog.sessionIds[0]!, posterMemberId: poster },
          { uid: claimer },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

describe('claimLookingForPartner concurrency', () => {
  it('two members racing to claim one poster: exactly one succeeds', async () => {
    const poster = await makeMember('claim-race-poster@example.org');
    const claimerOne = await makeMember('claim-race-one@example.org');
    const claimerTwo = await makeMember('claim-race-two@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>(
        { year: prog.year, sessionId: prog.sessionIds[0]!, status: 'looking_for_partner' },
        { uid: poster },
      ),
    );

    const results = await Promise.allSettled([
      claimLookingForPartnerHandler(
        fakeCallableRequest<ClaimLookingForPartnerInput>(
          { year: prog.year, sessionId: prog.sessionIds[0]!, posterMemberId: poster },
          { uid: claimerOne },
        ),
      ),
      claimLookingForPartnerHandler(
        fakeCallableRequest<ClaimLookingForPartnerInput>(
          { year: prog.year, sessionId: prog.sessionIds[0]!, posterMemberId: poster },
          { uid: claimerTwo },
        ),
      ),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await assertSessionPairingValid(prog.sessionIds[0]!);
  });
});

describe('repeatPartnerWarning', () => {
  it('is true for an Individual series when the same pair forms again on another session', async () => {
    const a = await makeMember('repeat-a@example.org');
    const b = await makeMember('repeat-b@example.org');
    const prog = await makeProgramme({
      seriesFormat: 'Individual',
      dates: [sessionInFuture('monday', 3), sessionInFuture('monday', 4)],
    });

    // Week 1: a and b pair via invite accept.
    const { invite: invite1 } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0]!, toMemberId: b },
        { uid: a },
      ),
    );
    const firstAccept = await respondToInviteHandler(
      fakeCallableRequest<RespondToInviteInput>({ inviteId: invite1.id, accept: true }, { uid: b }),
    );
    expect(firstAccept.repeatPartnerWarning).toBeFalsy();

    // Week 2: a and b pair again on the second session.
    const { invite: invite2 } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[1]!, toMemberId: b },
        { uid: a },
      ),
    );
    const secondAccept = await respondToInviteHandler(
      fakeCallableRequest<RespondToInviteInput>({ inviteId: invite2.id, accept: true }, { uid: b }),
    );

    expect(secondAccept.repeatPartnerWarning).toBe(true);
    await assertSessionPairingValid(prog.sessionIds[0]!);
    await assertSessionPairingValid(prog.sessionIds[1]!);
  });

  it('is false for a Pairs series', async () => {
    const a = await makeMember('repeat-pairs-a@example.org');
    const b = await makeMember('repeat-pairs-b@example.org');
    const prog = await makeProgramme({
      seriesFormat: 'Pairs',
      dates: [sessionInFuture('monday', 3), sessionInFuture('monday', 4)],
    });

    const { invite: invite1 } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0]!, toMemberId: b },
        { uid: a },
      ),
    );
    await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite1.id, accept: true }, { uid: b }));

    const { invite: invite2 } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[1]!, toMemberId: b },
        { uid: a },
      ),
    );
    const secondAccept = await respondToInviteHandler(
      fakeCallableRequest<RespondToInviteInput>({ inviteId: invite2.id, accept: true }, { uid: b }),
    );

    expect(secondAccept.repeatPartnerWarning).toBeFalsy();
  });

  it('claimLookingForPartner also surfaces the warning for an Individual series', async () => {
    const a = await makeMember('repeat-claim-a@example.org');
    const b = await makeMember('repeat-claim-b@example.org');
    const prog = await makeProgramme({
      seriesFormat: 'Individual',
      dates: [sessionInFuture('monday', 3), sessionInFuture('monday', 4)],
    });

    const { invite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0]!, toMemberId: b },
        { uid: a },
      ),
    );
    await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.id, accept: true }, { uid: b }));

    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>(
        { year: prog.year, sessionId: prog.sessionIds[1]!, status: 'looking_for_partner' },
        { uid: a },
      ),
    );
    const claim = await claimLookingForPartnerHandler(
      fakeCallableRequest<ClaimLookingForPartnerInput>(
        { year: prog.year, sessionId: prog.sessionIds[1]!, posterMemberId: a },
        { uid: b },
      ),
    );

    expect(claim.repeatPartnerWarning).toBe(true);
  });
});


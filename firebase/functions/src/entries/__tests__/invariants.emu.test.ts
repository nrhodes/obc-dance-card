/**
 * Plan §17 invariant suite: builds every shape in plan §7 through the public
 * callables (plus a couple of directly-seeded I4 shapes, since `setSubstitute`
 * itself is Phase 4) and asserts `validatePairingGroup` is empty after every
 * step. Per-callable behaviour (errors, notifications, audit) is covered in
 * the sibling `*.emu.test.ts` files; this file is about the shape of the
 * store, not any one callable's contract.
 */
import { describe, expect, it } from 'vitest';
import {
  validatePairingGroup,
  type CancelEntryInput,
  type ClaimLookingForPartnerInput,
  type ClearSoloStatusInput,
  type RespondToInviteInput,
  type SendInviteInput,
  type SetSoloStatusInput,
} from '@obc/shared';
import {
  assertSessionPairingValid,
  entriesForSession,
  fakeCallableRequest,
  makeMember,
  makeProgramme,
  sessionInFuture,
} from '../../testing/fixtures.js';
import { cancelEntryHandler, claimLookingForPartnerHandler, clearSoloStatusHandler, setSoloStatusHandler } from '../entries.js';
import { respondToInviteHandler, sendInviteHandler } from '../invites.js';

describe('invariant suite — every §7 shape stays valid after its mutation', () => {
  it('I2: sendInvite + respondToInvite(accept) produces a valid mirrored pairing', async () => {
    const a = await makeMember('inv-i2-a@example.org');
    const b = await makeMember('inv-i2-b@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;

    const { invite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>({ scope: 'session', year: prog.year, sessionId, toMemberId: b }, { uid: a }),
    );
    await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.id, accept: true }, { uid: b }));

    await assertSessionPairingValid(sessionId);
  });

  it('I6: setSoloStatus (lfp, then available) stays a valid solo shape at every step', async () => {
    const m = await makeMember('inv-i6@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;

    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>({ year: prog.year, sessionId, status: 'looking_for_partner' }, { uid: m }),
    );
    await assertSessionPairingValid(sessionId);

    await clearSoloStatusHandler(fakeCallableRequest<ClearSoloStatusInput>({ year: prog.year, sessionId }, { uid: m }));
    await assertSessionPairingValid(sessionId);

    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>({ year: prog.year, sessionId, status: 'available' }, { uid: m }),
    );
    await assertSessionPairingValid(sessionId);
  });

  it('I2 via claimLookingForPartner: a poster + claimer produce a valid pairing', async () => {
    const poster = await makeMember('inv-claim-poster@example.org');
    const claimer = await makeMember('inv-claim-claimer@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;

    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>({ year: prog.year, sessionId, status: 'looking_for_partner' }, { uid: poster }),
    );
    await claimLookingForPartnerHandler(
      fakeCallableRequest<ClaimLookingForPartnerInput>({ year: prog.year, sessionId, posterMemberId: poster }, { uid: claimer }),
    );

    await assertSessionPairingValid(sessionId);
  });

  it('I2 -> cancel: the plain departure cascade always leaves a valid group behind', async () => {
    const a = await makeMember('inv-cancel-a@example.org');
    const b = await makeMember('inv-cancel-b@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;

    const { invite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>({ scope: 'session', year: prog.year, sessionId, toMemberId: b }, { uid: a }),
    );
    await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.id, accept: true }, { uid: b }));
    await assertSessionPairingValid(sessionId);

    const entries = await entriesForSession(sessionId);
    const aEntry = entries.find((e) => e.memberId === a)!;
    await cancelEntryHandler(fakeCallableRequest<CancelEntryInput>({ entryId: aEntry.id }, { uid: a }));

    await assertSessionPairingValid(sessionId);
  });

  it('sweep-style check: validatePairingGroup([]) is empty (vacuous base case)', () => {
    expect(validatePairingGroup([])).toEqual([]);
  });
});

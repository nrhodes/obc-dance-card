import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  CancelEntryInput,
  ClearSubstituteInput,
  CreateVisitorInput,
  RespondToInviteInput,
  SendInviteInput,
  SetSubstituteInput,
} from '@obc/shared';
import {
  assertSessionPairingValid,
  fakeCallableRequest,
  makeMember,
  makeProgramme,
  notificationsFor,
  sessionInFuture,
} from '../../testing/fixtures.js';
import { createVisitorHandler } from '../../visitors/visitors.js';
import { signUpWithVisitorHandler } from '../../visitors/signUp.js';
import { entryId } from '../lib.js';
import { cancelEntryHandler } from '../entries.js';
import { respondToInviteHandler, sendInviteHandler } from '../invites.js';
import { clearSubstituteHandler, setSubstituteHandler } from '../substitute.js';

/** Pairs `a` and `b` on the given session via the normal invite flow. */
async function pairViaInvite(sessionId: string, year: number, a: string, b: string): Promise<void> {
  const { invite } = await sendInviteHandler(
    fakeCallableRequest<SendInviteInput>({ scope: 'session', year, sessionId, toMemberId: b }, { uid: a }),
  );
  await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.id, accept: true }, { uid: b }));
}

describe('setSubstitute', () => {
  it('coverFor "self" (default): the covered member names their own substitute — I4 shape', async () => {
    const a = await makeMember('sub-self-a@example.org');
    const b = await makeMember('sub-self-b@example.org');
    const x = await makeMember('sub-self-x@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    await pairViaInvite(sessionId, prog.year, a, b);

    const bEntryId = entryId(sessionId, b);
    const result = await setSubstituteHandler(
      fakeCallableRequest<SetSubstituteInput>({ entryId: bEntryId, substitute: { kind: 'member', memberId: x } }, { uid: b }),
    );

    const entries = await assertSessionPairingValid(sessionId);
    const aEntry = entries.find((e) => e.memberId === a)!;
    const bEntry = entries.find((e) => e.memberId === b)!;
    const xEntry = entries.find((e) => e.memberId === x)!;

    expect(bEntry.status).toBe('substituted');
    expect(bEntry.substitute).toEqual({ kind: 'member', memberId: x, displayName: expect.any(String) });
    expect(aEntry.partnerSubstitute).toEqual(bEntry.substitute);
    expect(xEntry.status).toBe('confirmed');
    expect(xEntry.partner).toEqual({ kind: 'member', memberId: a, displayName: expect.any(String) });
    expect(xEntry.isSubstituteFor).toBe(b);
    expect(xEntry.pairingId).toBe(bEntry.pairingId);
    expect(result.entries.map((e) => e.id).sort()).toEqual([bEntryId, aEntry.id, xEntry.id].sort());

    expect(await notificationsFor(x, 'substitute_arranged')).toHaveLength(1);
    expect(await notificationsFor(a, 'substitute_arranged')).toHaveLength(1);
  });

  it('coverFor "partner": the remaining partner names a substitute for the other side', async () => {
    const a = await makeMember('sub-partner-a@example.org');
    const b = await makeMember('sub-partner-b@example.org');
    const x = await makeMember('sub-partner-x@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    await pairViaInvite(sessionId, prog.year, a, b);

    // a (the remaining partner) arranges a sub for b.
    await setSubstituteHandler(
      fakeCallableRequest<SetSubstituteInput>(
        { entryId: entryId(sessionId, a), substitute: { kind: 'member', memberId: x }, coverFor: 'partner' },
        { uid: a },
      ),
    );

    const entries = await assertSessionPairingValid(sessionId);
    const bEntry = entries.find((e) => e.memberId === b)!;
    const aEntry = entries.find((e) => e.memberId === a)!;
    expect(bEntry.status).toBe('substituted');
    expect(aEntry.status).toBe('confirmed');
    expect(aEntry.partnerSubstitute).toEqual({ kind: 'member', memberId: x, displayName: expect.any(String) });
  });

  it('visitor substitute: no extra entry is created, and the covered entry carries the visitor ref', async () => {
    const a = await makeMember('sub-visitor-a@example.org');
    const b = await makeMember('sub-visitor-b@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    await pairViaInvite(sessionId, prog.year, a, b);

    const { visitor } = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>({ displayName: 'Sub Visitor' }, { uid: a }),
    );

    const result = await setSubstituteHandler(
      fakeCallableRequest<SetSubstituteInput>(
        { entryId: entryId(sessionId, b), substitute: { kind: 'visitor', visitorId: visitor.id } },
        { uid: b },
      ),
    );

    expect(result.entries).toHaveLength(2);
    const entries = await assertSessionPairingValid(sessionId);
    const bEntry = entries.find((e) => e.memberId === b)!;
    expect(bEntry.substitute).toEqual({ kind: 'visitor', visitorId: visitor.id, displayName: 'Sub Visitor' });
  });

  it('rejects when the series does not allow substitutes', async () => {
    const a = await makeMember('sub-noallow-a@example.org');
    const b = await makeMember('sub-noallow-b@example.org');
    const x = await makeMember('sub-noallow-x@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')], allowSubstitute: false });
    const sessionId = prog.sessionIds[0]!;
    await pairViaInvite(sessionId, prog.year, a, b);

    await expect(
      setSubstituteHandler(
        fakeCallableRequest<SetSubstituteInput>(
          { entryId: entryId(sessionId, b), substitute: { kind: 'member', memberId: x } },
          { uid: b },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects a substitute who is already busy that session', async () => {
    const a = await makeMember('sub-busy-a@example.org');
    const b = await makeMember('sub-busy-b@example.org');
    const x = await makeMember('sub-busy-x@example.org');
    const other = await makeMember('sub-busy-other@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    await pairViaInvite(sessionId, prog.year, a, b);
    await pairViaInvite(sessionId, prog.year, x, other);

    await expect(
      setSubstituteHandler(
        fakeCallableRequest<SetSubstituteInput>(
          { entryId: entryId(sessionId, b), substitute: { kind: 'member', memberId: x } },
          { uid: b },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects naming one of the pairing’s own players as the substitute', async () => {
    const a = await makeMember('sub-selfsub-a@example.org');
    const b = await makeMember('sub-selfsub-b@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    await pairViaInvite(sessionId, prog.year, a, b);

    await expect(
      setSubstituteHandler(
        fakeCallableRequest<SetSubstituteInput>(
          { entryId: entryId(sessionId, b), substitute: { kind: 'member', memberId: a } },
          { uid: b },
        ),
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects arranging a second substitute for an already-substituted pairing', async () => {
    const a = await makeMember('sub-already-a@example.org');
    const b = await makeMember('sub-already-b@example.org');
    const x = await makeMember('sub-already-x@example.org');
    const y = await makeMember('sub-already-y@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    await pairViaInvite(sessionId, prog.year, a, b);

    await setSubstituteHandler(
      fakeCallableRequest<SetSubstituteInput>(
        { entryId: entryId(sessionId, b), substitute: { kind: 'member', memberId: x } },
        { uid: b },
      ),
    );

    await expect(
      setSubstituteHandler(
        fakeCallableRequest<SetSubstituteInput>(
          { entryId: entryId(sessionId, b), substitute: { kind: 'member', memberId: y } },
          { uid: b },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects substituting a visitor pairing', async () => {
    const a = await makeMember('sub-visitorpair-a@example.org');
    const x = await makeMember('sub-visitorpair-x@example.org');
    const { visitor } = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>({ displayName: 'Main Visitor' }, { uid: a }),
    );
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    await signUpWithVisitorHandler(
      fakeCallableRequest({ scope: 'session', year: prog.year, sessionId, visitorId: visitor.id }, { uid: a }),
    );

    await expect(
      setSubstituteHandler(
        fakeCallableRequest<SetSubstituteInput>(
          { entryId: entryId(sessionId, a), substitute: { kind: 'member', memberId: x } },
          { uid: a },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

describe('clearSubstitute', () => {
  async function setUpSubstitutedPairing() {
    const a = await makeMember(`sub-clear-a-${randomUUID()}@example.org`);
    const b = await makeMember(`sub-clear-b-${randomUUID()}@example.org`);
    const x = await makeMember(`sub-clear-x-${randomUUID()}@example.org`);
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    await pairViaInvite(sessionId, prog.year, a, b);
    await setSubstituteHandler(
      fakeCallableRequest<SetSubstituteInput>(
        { entryId: entryId(sessionId, b), substitute: { kind: 'member', memberId: x } },
        { uid: b },
      ),
    );
    return { a, b, x, prog, sessionId };
  }

  it('the covered member clearing restores I2 and cancels the sub’s entry', async () => {
    const { a, b, x, sessionId } = await setUpSubstitutedPairing();

    await clearSubstituteHandler(fakeCallableRequest<ClearSubstituteInput>({ entryId: entryId(sessionId, b) }, { uid: b }));

    const entries = await assertSessionPairingValid(sessionId);
    const bEntry = entries.find((e) => e.memberId === b)!;
    const aEntry = entries.find((e) => e.memberId === a)!;
    const xEntry = entries.find((e) => e.memberId === x)!;

    expect(bEntry.status).toBe('confirmed');
    expect(bEntry.substitute).toBeNull();
    expect(aEntry.partnerSubstitute).toBeNull();
    expect(xEntry.status).toBe('cancelled');

    expect(await notificationsFor(x, 'substitute_cleared')).toHaveLength(1);
    expect(await notificationsFor(a, 'substitute_cleared')).toHaveLength(1);
  });

  it('the remaining partner clearing also restores I2', async () => {
    const { a, b, x, sessionId } = await setUpSubstitutedPairing();

    await clearSubstituteHandler(fakeCallableRequest<ClearSubstituteInput>({ entryId: entryId(sessionId, a) }, { uid: a }));

    const entries = await assertSessionPairingValid(sessionId);
    const bEntry = entries.find((e) => e.memberId === b)!;
    const xEntry = entries.find((e) => e.memberId === x)!;
    expect(bEntry.status).toBe('confirmed');
    expect(xEntry.status).toBe('cancelled');
  });

  it('the substitute cannot clear it themselves', async () => {
    const { x, sessionId } = await setUpSubstitutedPairing();

    await expect(
      clearSubstituteHandler(fakeCallableRequest<ClearSubstituteInput>({ entryId: entryId(sessionId, x) }, { uid: x })),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('setSubstitute / clearSubstitute — cross-check against cancelEntry (Phase 3a cascade)', () => {
  it('cancelEntry from A (remaining) on a setSubstitute-produced I4 shape matches the documented cascade', async () => {
    const a = await makeMember('sub-cancelA-a@example.org');
    const b = await makeMember('sub-cancelA-b@example.org');
    const x = await makeMember('sub-cancelA-x@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    await pairViaInvite(sessionId, prog.year, a, b);
    await setSubstituteHandler(
      fakeCallableRequest<SetSubstituteInput>(
        { entryId: entryId(sessionId, b), substitute: { kind: 'member', memberId: x } },
        { uid: b },
      ),
    );

    const result = await cancelEntryHandler(fakeCallableRequest<CancelEntryInput>({ entryId: entryId(sessionId, a) }, { uid: a }));
    expect(result.entry.status).toBe('cancelled');
    expect(result.partnerEntry?.memberId).toBe(b);
    expect(result.partnerEntry?.status).toBe('looking_for_partner');

    const entries = await assertSessionPairingValid(sessionId);
    expect(entries.find((e) => e.memberId === x)!.status).toBe('cancelled');
  });

  it('cancelEntry from B (covered) promotes X to A’s real partner', async () => {
    const a = await makeMember('sub-cancelB-a@example.org');
    const b = await makeMember('sub-cancelB-b@example.org');
    const x = await makeMember('sub-cancelB-x@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    await pairViaInvite(sessionId, prog.year, a, b);
    await setSubstituteHandler(
      fakeCallableRequest<SetSubstituteInput>(
        { entryId: entryId(sessionId, b), substitute: { kind: 'member', memberId: x } },
        { uid: b },
      ),
    );

    await cancelEntryHandler(fakeCallableRequest<CancelEntryInput>({ entryId: entryId(sessionId, b) }, { uid: b }));

    const entries = await assertSessionPairingValid(sessionId);
    const aEntry = entries.find((e) => e.memberId === a)!;
    const xEntry = entries.find((e) => e.memberId === x)!;
    expect(aEntry.status).toBe('confirmed');
    expect(aEntry.partner).toEqual({ kind: 'member', memberId: x, displayName: expect.any(String) });
    expect(xEntry.isSubstituteFor).toBeNull();
  });

  it('cancelEntry from X (the substitute) reverts to the plain I2 shape', async () => {
    const a = await makeMember('sub-cancelX-a@example.org');
    const b = await makeMember('sub-cancelX-b@example.org');
    const x = await makeMember('sub-cancelX-x@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    await pairViaInvite(sessionId, prog.year, a, b);
    await setSubstituteHandler(
      fakeCallableRequest<SetSubstituteInput>(
        { entryId: entryId(sessionId, b), substitute: { kind: 'member', memberId: x } },
        { uid: b },
      ),
    );

    await cancelEntryHandler(fakeCallableRequest<CancelEntryInput>({ entryId: entryId(sessionId, x) }, { uid: x }));

    const entries = await assertSessionPairingValid(sessionId);
    const bEntry = entries.find((e) => e.memberId === b)!;
    expect(bEntry.status).toBe('confirmed');
    expect(bEntry.substitute).toBeNull();
  });
});

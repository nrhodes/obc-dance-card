import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  paths,
  type CancelEntryInput,
  type Entry,
  type RespondToInviteInput,
  type SendInviteInput,
  type Team,
} from '@obc/shared';
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
import { entryId } from '../lib.js';
import { cancelEntryHandler } from '../entries.js';
import { respondToInviteHandler, sendInviteHandler } from '../invites.js';

function baseEntry(sessionId: string, memberId: string, date: string): Entry {
  const now = new Date().toISOString();
  return {
    id: entryId(sessionId, memberId),
    sessionId,
    date,
    weekday: 'monday',
    seriesId: null,
    memberId,
    status: 'confirmed',
    partner: null,
    pairingId: null,
    teamId: null,
    teamSessionOnly: false,
    substitute: null,
    partnerSubstitute: null,
    isSubstituteFor: null,
    createdBy: memberId,
    createdAt: now,
    updatedAt: now,
  };
}

async function seed(entry: Entry): Promise<void> {
  await db.doc(paths.entry(entry.id)).set(entry);
}

/** Seeds the I4 shape directly: A (remaining) & B (substituted by member X). */
async function seedMemberSubstitutePairing(sessionId: string, date: string, a: string, b: string, x: string) {
  const pairingId = randomUUID();
  await seed({
    ...baseEntry(sessionId, a, date),
    partner: { kind: 'member', memberId: b, displayName: 'B' },
    partnerSubstitute: { kind: 'member', memberId: x, displayName: 'X' },
    pairingId,
  });
  await seed({
    ...baseEntry(sessionId, b, date),
    status: 'substituted',
    partner: { kind: 'member', memberId: a, displayName: 'A' },
    substitute: { kind: 'member', memberId: x, displayName: 'X' },
    pairingId,
  });
  await seed({
    ...baseEntry(sessionId, x, date),
    partner: { kind: 'member', memberId: a, displayName: 'A' },
    isSubstituteFor: b,
    pairingId,
  });
  return pairingId;
}

describe('cancelEntry — plain pairing', () => {
  it('flips the partner to looking_for_partner and notifies them', async () => {
    const a = await makeMember('cancel-plain-a@example.org');
    const b = await makeMember('cancel-plain-b@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    const { invite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0]!, toMemberId: b },
        { uid: a },
      ),
    );
    await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.id, accept: true }, { uid: b }));

    const aEntryId = entryId(prog.sessionIds[0]!, a);
    const result = await cancelEntryHandler(fakeCallableRequest<CancelEntryInput>({ entryId: aEntryId }, { uid: a }));

    expect(result.entry.status).toBe('cancelled');
    expect(result.partnerEntry?.status).toBe('looking_for_partner');
    expect(result.partnerEntry?.memberId).toBe(b);

    await assertSessionPairingValid(prog.sessionIds[0]!);
    expect(await notificationsFor(b, 'partner_cancelled')).toHaveLength(1);
  });

  it('rejects cancelling someone else’s entry', async () => {
    const a = await makeMember('cancel-notowner-a@example.org');
    const b = await makeMember('cancel-notowner-b@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    const { invite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0]!, toMemberId: b },
        { uid: a },
      ),
    );
    await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.id, accept: true }, { uid: b }));

    const aEntryId = entryId(prog.sessionIds[0]!, a);
    await expect(
      cancelEntryHandler(fakeCallableRequest<CancelEntryInput>({ entryId: aEntryId }, { uid: b })),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects cancelling on a locked session', async () => {
    const a = await makeMember('cancel-locked-a@example.org');
    const b = await makeMember('cancel-locked-b@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    const { invite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0]!, toMemberId: b },
        { uid: a },
      ),
    );
    await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.id, accept: true }, { uid: b }));

    // Move the session into the past directly (simulating time passing).
    await db
      .doc(paths.session(prog.year, prog.sessionIds[0]!))
      .set({ date: sessionInPast('monday') }, { merge: true });

    const aEntryId = entryId(prog.sessionIds[0]!, a);
    await expect(
      cancelEntryHandler(fakeCallableRequest<CancelEntryInput>({ entryId: aEntryId }, { uid: a })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('admin on-behalf cancellation is audited and notifies the member', async () => {
    const admin = await makeMember('cancel-admin@example.org', { role: 'admin' });
    const a = await makeMember('cancel-onbehalf-a@example.org');
    const b = await makeMember('cancel-onbehalf-b@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    const { invite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0]!, toMemberId: b },
        { uid: a },
      ),
    );
    await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.id, accept: true }, { uid: b }));

    const aEntryId = entryId(prog.sessionIds[0]!, a);
    await cancelEntryHandler(
      fakeCallableRequest<CancelEntryInput>({ entryId: aEntryId, onBehalfOfMemberId: a }, { uid: admin }),
    );

    const auditSnap = await db.collection(paths.auditLog()).where('action', '==', 'cancel_entry_on_behalf').get();
    expect(auditSnap.docs.some((d) => d.data().actorMemberId === admin && d.data().targetMemberId === a)).toBe(true);
    expect(await notificationsFor(a, 'on_behalf_action')).toHaveLength(1);
  });
});

describe('cancelEntry — substitution cascade (I4)', () => {
  it('remaining partner (A) cancelling also cancels the member substitute (X), notifying B and X', async () => {
    const a = await makeMember('cancel-sub-a@example.org');
    const b = await makeMember('cancel-sub-b@example.org');
    const x = await makeMember('cancel-sub-x@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    const date = sessionInFuture('monday');

    await seedMemberSubstitutePairing(sessionId, date, a, b, x);
    await assertSessionPairingValid(sessionId);

    const result = await cancelEntryHandler(
      fakeCallableRequest<CancelEntryInput>({ entryId: entryId(sessionId, a) }, { uid: a }),
    );

    expect(result.entry.status).toBe('cancelled');
    expect(result.partnerEntry?.memberId).toBe(b);
    expect(result.partnerEntry?.status).toBe('looking_for_partner');

    const entries = await assertSessionPairingValid(sessionId);
    const xEntry = entries.find((e) => e.memberId === x)!;
    expect(xEntry.status).toBe('cancelled');

    expect(await notificationsFor(b, 'partner_cancelled')).toHaveLength(1);
    expect(await notificationsFor(x, 'partner_cancelled')).toHaveLength(1);
  });

  it('the covered member (B) cancelling promotes the substitute (X) to A’s real partner', async () => {
    const a = await makeMember('cancel-promote-a@example.org');
    const b = await makeMember('cancel-promote-b@example.org');
    const x = await makeMember('cancel-promote-x@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    const date = sessionInFuture('monday');

    await seedMemberSubstitutePairing(sessionId, date, a, b, x);

    const result = await cancelEntryHandler(
      fakeCallableRequest<CancelEntryInput>({ entryId: entryId(sessionId, b) }, { uid: b }),
    );
    expect(result.entry.status).toBe('cancelled');

    const entries = await assertSessionPairingValid(sessionId);
    const aEntry = entries.find((e) => e.memberId === a)!;
    const xEntry = entries.find((e) => e.memberId === x)!;

    expect(aEntry.status).toBe('confirmed');
    expect(aEntry.partner).toEqual({ kind: 'member', memberId: x, displayName: 'X' });
    expect(aEntry.partnerSubstitute).toBeNull();

    expect(xEntry.status).toBe('confirmed');
    expect(xEntry.isSubstituteFor).toBeNull();
    expect(xEntry.partner).toEqual({ kind: 'member', memberId: a, displayName: 'A' });
  });

  it('the substitute (X) cancelling reverts the pairing to the plain I2 shape', async () => {
    const a = await makeMember('cancel-revert-a@example.org');
    const b = await makeMember('cancel-revert-b@example.org');
    const x = await makeMember('cancel-revert-x@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    const date = sessionInFuture('monday');

    await seedMemberSubstitutePairing(sessionId, date, a, b, x);

    await cancelEntryHandler(fakeCallableRequest<CancelEntryInput>({ entryId: entryId(sessionId, x) }, { uid: x }));

    const entries = await assertSessionPairingValid(sessionId);
    const aEntry = entries.find((e) => e.memberId === a)!;
    const bEntry = entries.find((e) => e.memberId === b)!;
    const xEntry = entries.find((e) => e.memberId === x)!;

    expect(bEntry.status).toBe('confirmed');
    expect(bEntry.substitute).toBeNull();
    expect(aEntry.partnerSubstitute).toBeNull();
    expect(xEntry.status).toBe('cancelled');

    expect(await notificationsFor(a, 'substitute_cleared')).toHaveLength(1);
    expect(await notificationsFor(b, 'substitute_cleared')).toHaveLength(1);
  });
});

describe('cancelEntry — visitor pairing', () => {
  it('cancels only the member’s own entry', async () => {
    const a = await makeMember('cancel-visitor-a@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    const date = sessionInFuture('monday');

    await seed({
      ...baseEntry(sessionId, a, date),
      partner: { kind: 'visitor', visitorId: 'visitor-1', displayName: 'Jane Visitor' },
      pairingId: randomUUID(),
    });

    const result = await cancelEntryHandler(fakeCallableRequest<CancelEntryInput>({ entryId: entryId(sessionId, a) }, { uid: a }));
    expect(result.entry.status).toBe('cancelled');
    expect(result.entry.partner).toBeNull();
    expect(result.partnerEntry).toBeUndefined();

    await assertSessionPairingValid(sessionId);
  });
});

describe('cancelEntry — team entry', () => {
  it('cancels only the member’s own entry and notifies the captain', async () => {
    const captain = await makeMember('cancel-team-captain@example.org');
    const member = await makeMember('cancel-team-member@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    const date = sessionInFuture('monday');

    const team: Team = {
      id: `${prog.seriesId}-${captain}`,
      year: prog.year,
      seriesId: prog.seriesId,
      name: 'Test Team',
      captainMemberId: captain,
      members: [
        { ref: { kind: 'member', memberId: captain, displayName: 'Captain' }, joinedAt: new Date().toISOString() },
        { ref: { kind: 'member', memberId: member, displayName: 'Member' }, joinedAt: new Date().toISOString() },
      ],
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db.doc(paths.team(team.id)).set(team);

    await seed({ ...baseEntry(sessionId, captain, date), teamId: team.id });
    await seed({ ...baseEntry(sessionId, member, date), teamId: team.id });

    const result = await cancelEntryHandler(
      fakeCallableRequest<CancelEntryInput>({ entryId: entryId(sessionId, member) }, { uid: member }),
    );
    expect(result.entry.status).toBe('cancelled');

    const entries = await entriesForSession(sessionId);
    const captainEntry = entries.find((e) => e.memberId === captain)!;
    expect(captainEntry.status).toBe('confirmed'); // team is unchanged (I9)

    expect(await notificationsFor(captain, 'team_member_absent')).toHaveLength(1);
  });

  it('notifies the captain even when the captain themselves cancels', async () => {
    const captain = await makeMember('cancel-team-selfcaptain@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    const date = sessionInFuture('monday');

    const team: Team = {
      id: `${prog.seriesId}-${captain}`,
      year: prog.year,
      seriesId: prog.seriesId,
      name: 'Test Team',
      captainMemberId: captain,
      members: [{ ref: { kind: 'member', memberId: captain, displayName: 'Captain' }, joinedAt: new Date().toISOString() }],
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db.doc(paths.team(team.id)).set(team);
    await seed({ ...baseEntry(sessionId, captain, date), teamId: team.id });

    await cancelEntryHandler(fakeCallableRequest<CancelEntryInput>({ entryId: entryId(sessionId, captain) }, { uid: captain }));

    expect(await notificationsFor(captain, 'team_member_absent')).toHaveLength(1);
  });
});

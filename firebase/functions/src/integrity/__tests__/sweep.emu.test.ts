import { describe, expect, it } from 'vitest';
import { paths, type CreateTeamInput, type Entry, type InviteToTeamInput, type RespondToInviteInput, type Team } from '@obc/shared';
import { db } from '../../lib/admin.js';
import {
  assertSessionPairingValid,
  assertTeamValid,
  fakeCallableRequest,
  makeMember,
  makeProgramme,
  notificationsFor,
  sessionInFuture,
} from '../../testing/fixtures.js';
import { entryId } from '../../entries/lib.js';
import { respondToInviteHandler } from '../../entries/invites.js';
import { createTeamHandler, inviteToTeamHandler } from '../../teams/teams.js';
import { runPairingSweep } from '../sweep.js';

function confirmedEntry(
  sessionId: string,
  date: string,
  self: string,
  partner: string,
  partnerName: string,
  pairingId: string,
  overrides: Partial<Entry> = {},
): Entry {
  const now = new Date().toISOString();
  return {
    id: entryId(sessionId, self),
    sessionId,
    date,
    weekday: 'monday',
    seriesId: null,
    memberId: self,
    status: 'confirmed',
    partner: { kind: 'member', memberId: partner, displayName: partnerName },
    pairingId,
    teamId: null,
    teamSessionOnly: false,
    substitute: null,
    partnerSubstitute: null,
    isSubstituteFor: null,
    createdBy: self,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('runPairingSweep — clean store', () => {
  it('reports no violation for a valid pairing, and never repairs anything with repair:false', async () => {
    const a = await makeMember('sweep-clean-a@example.org');
    const b = await makeMember('sweep-clean-b@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    const date = sessionInFuture('monday');
    await db.doc(paths.entry(entryId(sessionId, a))).set(confirmedEntry(sessionId, date, a, b, 'B', 'p-clean'));
    await db.doc(paths.entry(entryId(sessionId, b))).set(confirmedEntry(sessionId, date, b, a, 'A', 'p-clean'));

    const report = await runPairingSweep({ repair: false });

    // The shared emulator accumulates fixtures from every other emu test
    // file across the whole run (some of which deliberately seed broken
    // states for their own purposes), so this only asserts that *this*
    // session is clean — never that the whole store is. `repaired` is
    // trivially 0 whenever `repair: false`, by construction.
    expect(report.violations.some((v) => v.id === sessionId)).toBe(false);
    expect(report.repaired).toBe(0);
    expect(report.checkedSessions).toBeGreaterThanOrEqual(1);
  });
});

describe('runPairingSweep — one-sided pairing (mirror missing)', () => {
  it('detects but does not repair when repair:false', async () => {
    const a = await makeMember('sweep-onesided-a@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    const date = sessionInFuture('monday');
    await db.doc(paths.entry(entryId(sessionId, a))).set(confirmedEntry(sessionId, date, a, 'ghost-member', 'Ghost', 'p-onesided'));

    const report = await runPairingSweep({ repair: false });
    expect(report.violations.some((v) => v.kind === 'pairing' && v.id === sessionId)).toBe(true);

    const entry = (await db.doc(paths.entry(entryId(sessionId, a))).get()).data() as Entry;
    expect(entry.status).toBe('confirmed'); // untouched
    expect(await notificationsFor(a, 'partner_cancelled')).toHaveLength(0);
  });

  it('repairs by freeing the member to looking_for_partner and notifying them', async () => {
    const a = await makeMember('sweep-onesided-repair-a@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    const date = sessionInFuture('monday');
    await db.doc(paths.entry(entryId(sessionId, a))).set(confirmedEntry(sessionId, date, a, 'ghost-member', 'Ghost', 'p-onesided-r'));

    const report = await runPairingSweep({ repair: true, actorMemberId: 'system' });
    expect(report.repaired).toBeGreaterThanOrEqual(1);

    const entries = await assertSessionPairingValid(sessionId);
    const entry = entries.find((e) => e.memberId === a)!;
    expect(entry.status).toBe('looking_for_partner');
    expect(entry.partner).toBeNull();
    expect(await notificationsFor(a, 'partner_cancelled')).toHaveLength(1);

    const auditSnap = await db.collection(paths.auditLog()).where('action', '==', 'pairing_repair').get();
    expect(auditSnap.docs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('runPairingSweep — mismatched pairingId', () => {
  it('detects and, on repair, frees both sides', async () => {
    const a = await makeMember('sweep-mismatch-a@example.org');
    const b = await makeMember('sweep-mismatch-b@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    const date = sessionInFuture('monday');
    // Both sides correctly reference each other, but carry *different* pairingIds.
    await db.doc(paths.entry(entryId(sessionId, a))).set(confirmedEntry(sessionId, date, a, b, 'B', 'p-mismatch-a'));
    await db.doc(paths.entry(entryId(sessionId, b))).set(confirmedEntry(sessionId, date, b, a, 'A', 'p-mismatch-b'));

    const detectOnly = await runPairingSweep({ repair: false });
    expect(detectOnly.violations.some((v) => v.kind === 'pairing' && v.id === sessionId)).toBe(true);

    const report = await runPairingSweep({ repair: true });
    expect(report.repaired).toBeGreaterThanOrEqual(2);

    const entries = await assertSessionPairingValid(sessionId);
    expect(entries.find((e) => e.memberId === a)!.status).toBe('looking_for_partner');
    expect(entries.find((e) => e.memberId === b)!.status).toBe('looking_for_partner');
    expect(await notificationsFor(a, 'partner_cancelled')).toHaveLength(1);
    expect(await notificationsFor(b, 'partner_cancelled')).toHaveLength(1);
  });
});

describe('runPairingSweep — orphan substitution fields', () => {
  it('clears the stray field on an otherwise-valid confirmed pairing, without notifying', async () => {
    const a = await makeMember('sweep-orphan-a@example.org');
    const b = await makeMember('sweep-orphan-b@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    const date = sessionInFuture('monday');
    await db.doc(paths.entry(entryId(sessionId, a))).set(confirmedEntry(sessionId, date, a, b, 'B', 'p-orphan'));
    await db.doc(paths.entry(entryId(sessionId, b))).set(
      confirmedEntry(sessionId, date, b, a, 'A', 'p-orphan', {
        substitute: { kind: 'member', memberId: 'ghost-sub', displayName: 'Ghost Sub' },
      }),
    );

    const detectOnly = await runPairingSweep({ repair: false });
    expect(detectOnly.violations.some((v) => v.kind === 'pairing' && v.id === sessionId)).toBe(true);

    await runPairingSweep({ repair: true });

    const entries = await assertSessionPairingValid(sessionId);
    const bEntry = entries.find((e) => e.memberId === b)!;
    expect(bEntry.status).toBe('confirmed');
    expect(bEntry.substitute).toBeNull();
    expect(await notificationsFor(a, 'partner_cancelled')).toHaveLength(0);
    expect(await notificationsFor(b, 'partner_cancelled')).toHaveLength(0);
  });
});

describe('runPairingSweep — team roster/entry mismatches', () => {
  it('detects and repairs a missing team entry for a rostered member', async () => {
    const captain = await makeMember('sweep-teammiss-captain@example.org');
    const member = await makeMember('sweep-teammiss-member@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', teamMin: 2, dates: [sessionInFuture('monday')] });
    const created = await createTeamHandler(fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }));
    const invite = await inviteToTeamHandler(
      fakeCallableRequest<InviteToTeamInput>({ teamId: created.team.id, toMemberId: member }, { uid: captain }),
    );
    await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.invite.id, accept: true }, { uid: member }));

    // Simulate a lost entry: delete the member's entry for the (only) future session.
    await db.doc(paths.entry(entryId(prog.sessionIds[0]!, member))).delete();

    const detectOnly = await runPairingSweep({ repair: false });
    expect(detectOnly.violations.some((v) => v.kind === 'team' && v.id === created.team.id)).toBe(true);

    const report = await runPairingSweep({ repair: true });
    expect(report.repaired).toBeGreaterThanOrEqual(1);

    const { entries } = await assertTeamValid(created.team.id);
    const restored = entries.find((e) => e.memberId === member && e.sessionId === prog.sessionIds[0]);
    expect(restored?.status).toBe('confirmed');
  });

  it('detects and repairs a non-rostered team entry', async () => {
    const captain = await makeMember('sweep-nonroster-captain@example.org');
    const member = await makeMember('sweep-nonroster-member@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', teamMin: 2, dates: [sessionInFuture('monday')] });
    const created = await createTeamHandler(fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }));
    const invite = await inviteToTeamHandler(
      fakeCallableRequest<InviteToTeamInput>({ teamId: created.team.id, toMemberId: member }, { uid: captain }),
    );
    await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.invite.id, accept: true }, { uid: member }));

    // Simulate a desynced roster: drop `member` from team.members directly, leaving their entry behind.
    const teamRef = db.doc(paths.team(created.team.id));
    const team = (await teamRef.get()).data() as Team;
    await teamRef.set({ ...team, members: team.members.filter((m) => !(m.ref.kind === 'member' && m.ref.memberId === member)) });

    const detectOnly = await runPairingSweep({ repair: false });
    expect(detectOnly.violations.some((v) => v.kind === 'team' && v.id === created.team.id)).toBe(true);

    const report = await runPairingSweep({ repair: true });
    expect(report.repaired).toBeGreaterThanOrEqual(1);

    const { entries } = await assertTeamValid(created.team.id);
    const leftover = entries.find((e) => e.memberId === member && e.sessionId === prog.sessionIds[0]);
    expect(leftover?.status).toBe('cancelled');
  });
});

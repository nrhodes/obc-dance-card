import { describe, expect, it } from 'vitest';
import {
  paths,
  type CreateTeamInput,
  type DeactivateMemberInput,
  type Entry,
  type EraseMemberInput,
  type InviteToTeamInput,
  type ReactivateMemberInput,
  type RespondToInviteInput,
  type SendInviteInput,
  type SetMemberRoleInput,
  type AddMemberInput,
  type Member,
  type MemberPrivate,
  type UpdateMemberInput,
} from '@obc/shared';
import { auth, db } from '../../lib/admin.js';
import {
  assertTeamValid,
  fakeCallableRequest,
  makeMember,
  makeProgramme,
  notificationsFor,
  sessionInFuture,
  sessionInPast,
  cp,
} from '../../testing/fixtures.js';
import { entryId } from '../../entries/lib.js';
import { sendInviteHandler, respondToInviteHandler } from '../../entries/invites.js';
import { createTeamHandler, inviteToTeamHandler } from '../../teams/teams.js';
import {
  addMemberHandler,
  deactivateMemberHandler,
  eraseMemberHandler,
  reactivateMemberHandler,
  setMemberRoleHandler,
  updateMemberHandler,
} from '../members.js';
import { createIcalFeedHandler } from '../../ical/tokens.js';
import { createHash } from 'node:crypto';

/**
 * The shared emulator accumulates every admin created by earlier tests
 * (across this whole file and every other emu test file in the run) without
 * ever clearing Firestore between tests. The last-admin guard's query counts
 * *every* active admin in the store, so a "sole admin" scenario has to
 * neutralise every other pre-existing active admin first, or the guard would
 * never trip. Safe to do — no other test re-checks these admins' state
 * afterwards.
 */
async function neutraliseOtherActiveAdmins(exceptUid: string): Promise<void> {
  const snap = await db.collection(cp.members()).where('role', '==', 'admin').where('active', '==', true).get();
  await Promise.all(
    snap.docs.filter((d) => d.id !== exceptUid).map((d) => d.ref.update({ active: false })),
  );
}

function pastPairEntry(sessionId: string, date: string, self: string, partner: string, partnerName: string): Entry {
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
    pairingId: `${sessionId}-pairing`,
    teamId: null,
    teamSessionOnly: false,
    substitute: null,
    partnerSubstitute: null,
    isSubstituteFor: null,
    createdBy: self,
    createdAt: now,
    updatedAt: now,
  };
}

describe('setMemberRole', () => {
  it('promotes a member to admin, revokes tokens, and notifies them', async () => {
    const admin = await makeMember('role-admin@example.org', { role: 'admin' });
    const member = await makeMember('role-member@example.org');
    const before = await auth.getUser(member);

    const result = await setMemberRoleHandler(
      fakeCallableRequest<SetMemberRoleInput>({ memberId: member, role: 'admin' }, { uid: admin }),
    );

    expect(result.member.role).toBe('admin');
    const after = await auth.getUser(member);
    expect(after.tokensValidAfterTime).toBeDefined();
    expect(after.tokensValidAfterTime).not.toBe(before.tokensValidAfterTime);

    const auditSnap = await db.collection(cp.auditLog()).where('action', '==', 'role_changed').get();
    expect(auditSnap.docs.some((d) => d.data().targetMemberId === member)).toBe(true);
    expect(await notificationsFor(member, 'security')).toHaveLength(1);
  });

  it('demotes an admin back to member when another admin remains', async () => {
    const admin1 = await makeMember('role-demote-admin1@example.org', { role: 'admin' });
    const admin2 = await makeMember('role-demote-admin2@example.org', { role: 'admin' });

    const result = await setMemberRoleHandler(
      fakeCallableRequest<SetMemberRoleInput>({ memberId: admin2, role: 'member' }, { uid: admin1 }),
    );
    expect(result.member.role).toBe('member');
  });

  it('last-admin guard: refuses when the sole admin tries to demote themselves', async () => {
    const admin = await makeMember('role-lastadmin-self@example.org', { role: 'admin' });
    await neutraliseOtherActiveAdmins(admin);

    await expect(
      setMemberRoleHandler(fakeCallableRequest<SetMemberRoleInput>({ memberId: admin, role: 'member' }, { uid: admin })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('last-admin guard: allows self-demotion when another active admin remains (guard counts correctly, not just "is this self")', async () => {
    const admin1 = await makeMember('role-selfdemote-ok1@example.org', { role: 'admin' });
    await makeMember('role-selfdemote-ok2@example.org', { role: 'admin' });

    const result = await setMemberRoleHandler(
      fakeCallableRequest<SetMemberRoleInput>({ memberId: admin1, role: 'member' }, { uid: admin1 }),
    );
    expect(result.member.role).toBe('member');
  });
});

describe('deactivateMember', () => {
  it('frees and notifies a future pairing partner, expires invites in both directions, disables Auth, and sets deactivatedAt', async () => {
    const admin = await makeMember('deact-admin@example.org', { role: 'admin' });
    const a = await makeMember('deact-a@example.org');
    const b = await makeMember('deact-b@example.org');
    const c = await makeMember('deact-c@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    const { invite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>({ scope: 'session', year: prog.year, sessionId: prog.sessionIds[0]!, toMemberId: b }, { uid: a }),
    );
    await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.id, accept: true }, { uid: b }));

    const prog2 = await makeProgramme({ dates: [sessionInFuture('tuesday')], weekday: 'tuesday' });
    const { invite: aToC } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>({ scope: 'session', year: prog2.year, sessionId: prog2.sessionIds[0]!, toMemberId: c }, { uid: a }),
    );

    const prog3 = await makeProgramme({ dates: [sessionInFuture('wednesday')], weekday: 'wednesday' });
    const { invite: cToA } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>({ scope: 'session', year: prog3.year, sessionId: prog3.sessionIds[0]!, toMemberId: a }, { uid: c }),
    );

    const beforeAuth = await auth.getUser(a);
    expect(beforeAuth.disabled).toBe(false);

    const result = await deactivateMemberHandler(fakeCallableRequest<DeactivateMemberInput>({ memberId: a }, { uid: admin }));

    expect(result.member.active).toBe(false);
    expect(result.member.deactivatedAt).toBeDefined();
    expect(result.cancelledEntries).toBeGreaterThanOrEqual(1);
    expect(result.expiredInvites).toBe(2);

    const afterAuth = await auth.getUser(a);
    expect(afterAuth.disabled).toBe(true);

    const bEntry = await db.doc(cp.entry(entryId(prog.sessionIds[0]!, b))).get();
    expect(bEntry.data()?.status).toBe('looking_for_partner');
    expect(await notificationsFor(b, 'partner_cancelled')).toHaveLength(1);

    const aToCSnap = await db.doc(cp.invite(aToC.id)).get();
    expect(aToCSnap.data()?.status).toBe('expired');
    expect(await notificationsFor(c, 'invite_expired')).toHaveLength(2);

    const cToASnap = await db.doc(cp.invite(cToA.id)).get();
    expect(cToASnap.data()?.status).toBe('expired');
  });

  it('leaves past entries untouched', async () => {
    const admin = await makeMember('deact-past-admin@example.org', { role: 'admin' });
    const a = await makeMember('deact-past-a@example.org');
    const b = await makeMember('deact-past-b@example.org');
    const date = sessionInPast('monday');
    const sessionId = `history-${Date.now()}`;

    await db.doc(cp.entry(entryId(sessionId, a))).set(pastPairEntry(sessionId, date, a, b, 'B Original'));
    await db.doc(cp.entry(entryId(sessionId, b))).set(pastPairEntry(sessionId, date, b, a, 'A Original'));

    await deactivateMemberHandler(fakeCallableRequest<DeactivateMemberInput>({ memberId: a }, { uid: admin }));

    const aEntry = (await db.doc(cp.entry(entryId(sessionId, a))).get()).data() as Entry;
    const bEntry = (await db.doc(cp.entry(entryId(sessionId, b))).get()).data() as Entry;
    expect(aEntry.status).toBe('confirmed');
    expect(bEntry.status).toBe('confirmed');
    expect(bEntry.partner).toEqual({ kind: 'member', memberId: a, displayName: 'A Original' });
  });

  it('transfers captaincy when the deactivated member was a team captain', async () => {
    const admin = await makeMember('deact-captain-admin@example.org', { role: 'admin' });
    const captain = await makeMember('deact-captain@example.org');
    const early = await makeMember('deact-captain-early@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', teamMin: 2, dates: [sessionInFuture('monday')] });
    const created = await createTeamHandler(fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }));
    const invite = await inviteToTeamHandler(
      fakeCallableRequest<InviteToTeamInput>({ teamId: created.team.id, toMemberId: early }, { uid: captain }),
    );
    await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.invite.id, accept: true }, { uid: early }));

    await deactivateMemberHandler(fakeCallableRequest<DeactivateMemberInput>({ memberId: captain }, { uid: admin }));

    const { team } = await assertTeamValid(created.team.id);
    expect(team.captainMemberId).toBe(early);
  });

  it('last-admin guard: refuses to deactivate the only active admin', async () => {
    const admin = await makeMember('deact-lastadmin@example.org', { role: 'admin' });
    await neutraliseOtherActiveAdmins(admin);

    await expect(
      deactivateMemberHandler(fakeCallableRequest<DeactivateMemberInput>({ memberId: admin }, { uid: admin })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

describe('reactivateMember', () => {
  it('flips active back on and re-enables the Auth account', async () => {
    const admin = await makeMember('react-admin@example.org', { role: 'admin' });
    const member = await makeMember('react-member@example.org');
    await deactivateMemberHandler(fakeCallableRequest<DeactivateMemberInput>({ memberId: member }, { uid: admin }));

    const result = await reactivateMemberHandler(fakeCallableRequest<ReactivateMemberInput>({ memberId: member }, { uid: admin }));

    expect(result.member.active).toBe(true);
    const authUser = await auth.getUser(member);
    expect(authUser.disabled).toBe(false);
    expect(await notificationsFor(member, 'security')).toHaveLength(1);
  });
});

describe('eraseMember', () => {
  async function backdateDeactivation(memberId: string, daysAgo: number): Promise<void> {
    const at = new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString();
    await db.doc(cp.member(memberId)).set({ deactivatedAt: at }, { merge: true });
  }

  it('refuses while the member is still active', async () => {
    const admin = await makeMember('erase-active-admin@example.org', { role: 'admin' });
    const member = await makeMember('erase-active-member@example.org', { firstName: 'Erase', lastName: 'Active' });

    await expect(
      eraseMemberHandler(fakeCallableRequest<EraseMemberInput>({ memberId: member, confirmName: 'Erase Active' }, { uid: admin })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('refuses when deactivated less than 30 days ago', async () => {
    const admin = await makeMember('erase-recent-admin@example.org', { role: 'admin' });
    const member = await makeMember('erase-recent-member@example.org', { firstName: 'Erase', lastName: 'Recent' });
    await deactivateMemberHandler(fakeCallableRequest<DeactivateMemberInput>({ memberId: member }, { uid: admin }));

    await expect(
      eraseMemberHandler(fakeCallableRequest<EraseMemberInput>({ memberId: member, confirmName: 'Erase Recent' }, { uid: admin })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  /** Security review 2026-11-16, L8: erasure must also remove the hash-keyed iCal lookup row. */
  it('deletes the iCal feed lookup doc along with the plaintext token', async () => {
    const admin = await makeMember('erase-ical-admin@example.org', { role: 'admin' });
    const member = await makeMember('erase-ical-member@example.org', { firstName: 'Erase', lastName: 'Ical' });
    const { url } = await createIcalFeedHandler(fakeCallableRequest({}, { uid: member }));
    const token = /\/ical\/([^/]+)\.ics$/.exec(url)![1]!;
    const lookupRef = db.doc(paths.icalToken(createHash('sha256').update(token).digest('hex')));
    expect((await lookupRef.get()).exists).toBe(true);

    await deactivateMemberHandler(fakeCallableRequest<DeactivateMemberInput>({ memberId: member }, { uid: admin }));
    await backdateDeactivation(member, 31);
    await eraseMemberHandler(fakeCallableRequest<EraseMemberInput>({ memberId: member, confirmName: 'Erase Ical' }, { uid: admin }));

    expect((await lookupRef.get()).exists).toBe(false);
    expect((await db.doc(paths.memberPrivate(member)).get()).get('icalToken')).toBeUndefined();
  });

  it('refuses when confirmName does not match exactly', async () => {
    const admin = await makeMember('erase-wrongname-admin@example.org', { role: 'admin' });
    const member = await makeMember('erase-wrongname-member@example.org', { firstName: 'Erase', lastName: 'Wrongname' });
    await deactivateMemberHandler(fakeCallableRequest<DeactivateMemberInput>({ memberId: member }, { uid: admin }));
    await backdateDeactivation(member, 31);

    await expect(
      eraseMemberHandler(fakeCallableRequest<EraseMemberInput>({ memberId: member, confirmName: 'Not The Name' }, { uid: admin })),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('scrubs the member, memberPrivate, visitors, entry references, team refs and notifications; deletes the Auth user; keeps the audit row', async () => {
    const admin = await makeMember('erase-full-admin@example.org', { role: 'admin' });
    const member = await makeMember('erase-full-member@example.org', { firstName: 'Erase', lastName: 'Full' });
    const other = await makeMember('erase-full-other@example.org');

    // A visitor owned by the erased member.
    const visitorId = 'erase-full-visitor';
    await db.doc(cp.visitor(visitorId)).set({
      id: visitorId,
      displayName: 'Their Visitor',
      createdByMemberId: member,
      courtesyEmails: false,
      lastUsedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // A past pairing so `other`'s entry keeps pointing at `member` after deactivation's cascade (which only touches future entries).
    const date = sessionInPast('monday');
    const sessionId = `erase-history-${Date.now()}`;
    await db.doc(cp.entry(entryId(sessionId, member))).set(pastPairEntry(sessionId, date, member, other, 'Other Person'));
    await db.doc(cp.entry(entryId(sessionId, other))).set(pastPairEntry(sessionId, date, other, member, 'Erase Full'));

    await deactivateMemberHandler(fakeCallableRequest<DeactivateMemberInput>({ memberId: member }, { uid: admin }));
    await backdateDeactivation(member, 31);

    // A team roster reference — added *after* deactivation, since
    // `deactivateMember` calls `removeMemberFromAllTeams`, which would try
    // (and fail, for this fabricated fixture team with no real series) to
    // process any team the member already belonged to at deactivation time.
    // Erasure itself doesn't care when the team was created — it just scans
    // every team doc at erase time.
    const teamId = `erase-full-team-${Date.now()}`;
    await db.doc(cp.team(teamId)).set({
      id: teamId,
      year: Number(date.slice(0, 4)),
      seriesId: 'erase-full-series',
      name: 'Erase Full Team',
      captainMemberId: other,
      members: [
        { ref: { kind: 'member', memberId: other, displayName: 'Other Person' }, joinedAt: new Date().toISOString() },
        { ref: { kind: 'member', memberId: member, displayName: 'Erase Full' }, joinedAt: new Date().toISOString() },
      ],
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // A notification addressed to the erased member.
    await db.collection(paths.notifications()).doc('erase-full-notif').set({
      id: 'erase-full-notif',
      memberId: member,
      type: 'security',
      title: 'x',
      body: 'y',
      data: {},
      channelsSent: ['inapp'],
      read: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = await eraseMemberHandler(
      fakeCallableRequest<EraseMemberInput>({ memberId: member, confirmName: 'Erase Full' }, { uid: admin }),
    );
    expect(result.ok).toBe(true);

    const memberDoc = (await db.doc(cp.member(member)).get()).data();
    expect(memberDoc?.firstName).toBe('Former');
    expect(memberDoc?.lastName).toBe('Member');
    expect(memberDoc?.phone).toBe('');
    expect(memberDoc?.erasedAt).toBeDefined();

    const privateDoc = (await db.doc(paths.memberPrivate(member)).get()).data();
    expect(privateDoc?.emailLower).toBe(`erased-${member}@erased.invalid`);
    expect(privateDoc?.devices).toEqual([]);
    expect(privateDoc?.hasPassword).toBe(false);

    await expect(auth.getUser(member)).rejects.toMatchObject({ code: 'auth/user-not-found' });

    const visitorSnap = await db.doc(cp.visitor(visitorId)).get();
    expect(visitorSnap.exists).toBe(false);

    const otherEntry = (await db.doc(cp.entry(entryId(sessionId, other))).get()).data() as Entry;
    expect(otherEntry.partner).toEqual({ kind: 'member', memberId: member, displayName: 'Former member' });
    const ownEntry = (await db.doc(cp.entry(entryId(sessionId, member))).get()).data() as Entry;
    expect(ownEntry.memberId).toBe(member); // history retained, not deleted

    const teamDoc = (await db.doc(cp.team(teamId)).get()).data() as { members: Array<{ ref: { kind: string; memberId?: string; displayName: string } }> };
    const memberRef = teamDoc.members.find((m) => m.ref.kind === 'member' && m.ref.memberId === member);
    expect(memberRef?.ref.displayName).toBe('Former member');

    expect(await notificationsFor(member)).toEqual([]);

    const auditSnap = await db.collection(cp.auditLog()).where('action', '==', 'member_erased').get();
    expect(auditSnap.docs.some((d) => d.data().targetMemberId === member)).toBe(true);
  });
});

describe('addMember', () => {
  it('creates the Auth user, member and memberPrivate docs exactly as an import row would, and audits it', async () => {
    const admin = await makeMember('add-admin@example.org', { role: 'admin' });

    const result = await addMemberHandler(
      fakeCallableRequest<AddMemberInput>(
        // Raw wire input: the schema trims and lower-cases.
        { firstName: ' Ada ', lastName: 'Byron', email: 'Add-New@Example.org', phone: '021 555 0199', grade: 'Junior' },
        { uid: admin },
      ),
    );

    const m = result.member;
    expect(m).toMatchObject({
      firstName: 'Ada',
      lastName: 'Byron',
      email: 'add-new@example.org',
      phone: '021 555 0199',
      grade: 'Junior',
      role: 'member',
      cohort: 'club',
      active: true,
    });
    const user = await auth.getUserByEmail('add-new@example.org');
    expect(user.uid).toBe(m.id);
    expect(user.disabled).toBe(false);
    const priv = (await db.doc(paths.memberPrivate(m.id)).get()).data() as MemberPrivate;
    expect(priv.emailLower).toBe('add-new@example.org');

    const auditSnap = await db.collection(cp.auditLog()).where('action', '==', 'member_added').get();
    expect(auditSnap.docs.some((d) => d.data().targetMemberId === m.id && d.data().actorMemberId === admin)).toBe(true);
  });

  it('refuses an email an existing member already has, and points an inactive one at reactivate', async () => {
    const admin = await makeMember('add-dup-admin@example.org', { role: 'admin' });
    await makeMember('add-dup-active@example.org');
    await makeMember('add-dup-inactive@example.org', { active: false });

    await expect(
      addMemberHandler(
        fakeCallableRequest<AddMemberInput>(
          { firstName: 'A', lastName: 'B', email: 'add-dup-active@example.org', grade: 'Open' },
          { uid: admin },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    await expect(
      addMemberHandler(
        fakeCallableRequest<AddMemberInput>(
          { firstName: 'A', lastName: 'B', email: 'add-dup-inactive@example.org', grade: 'Open' },
          { uid: admin },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition', message: expect.stringContaining('reactivate') });
  });

  it('is admin-only and rejects role/cohort smuggled into the input', async () => {
    const admin = await makeMember('add-guard-admin@example.org', { role: 'admin' });
    const member = await makeMember('add-guard-member@example.org');

    await expect(
      addMemberHandler(
        fakeCallableRequest<AddMemberInput>(
          { firstName: 'A', lastName: 'B', email: 'add-guard-new@example.org', grade: 'Open' },
          { uid: member },
        ),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });

    await expect(
      addMemberHandler(
        fakeCallableRequest(
          { firstName: 'A', lastName: 'B', email: 'add-guard-new@example.org', grade: 'Open', role: 'admin', cohort: 'review' } as unknown as AddMemberInput,
          { uid: admin },
        ),
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

describe('updateMember', () => {
  it('updates name, phone and grade; renames the member on partners\' entries; audits field names only', async () => {
    const admin = await makeMember('upd-admin@example.org', { role: 'admin' });
    const target = await makeMember('upd-target@example.org', { firstName: 'Jane', lastName: 'Doe' });
    const partner = await makeMember('upd-partner@example.org');
    const date = sessionInPast();
    const sessionId = `upd-rename-${target}`;
    await db.doc(cp.entry(entryId(sessionId, partner))).set(pastPairEntry(sessionId, date, partner, target, 'Jane Doe'));

    const result = await updateMemberHandler(
      fakeCallableRequest<UpdateMemberInput>(
        { memberId: target, patch: { lastName: 'Smith', phone: '09 555 0100', grade: 'Intermediate' } },
        { uid: admin },
      ),
    );

    expect(result.changed).toBe(true);
    expect(result.member).toMatchObject({ firstName: 'Jane', lastName: 'Smith', phone: '09 555 0100', grade: 'Intermediate' });
    const entry = (await db.doc(cp.entry(entryId(sessionId, partner))).get()).data() as Entry;
    expect(entry.partner).toMatchObject({ memberId: target, displayName: 'Jane Smith' });

    const auditSnap = await db.collection(cp.auditLog()).where('action', '==', 'member_updated').get();
    const mine = auditSnap.docs.map((d) => d.data()).find((d) => d.targetMemberId === target);
    expect(mine?.detail).toEqual({ fields: ['lastName', 'phone', 'grade'] });
    expect(JSON.stringify(mine)).not.toContain('Smith');
    // Not an email change: no security notification.
    expect(await notificationsFor(target, 'security')).toHaveLength(0);
  });

  it('changes the sign-in email in Auth, memberPrivate and members together, and notifies the member', async () => {
    const admin = await makeMember('upd-email-admin@example.org', { role: 'admin' });
    const target = await makeMember('upd-email-old@example.org');

    const result = await updateMemberHandler(
      fakeCallableRequest<UpdateMemberInput>(
        { memberId: target, patch: { email: 'Upd-Email-New@example.org' } },
        { uid: admin },
      ),
    );

    expect(result.member.email).toBe('upd-email-new@example.org');
    expect((await auth.getUser(target)).email).toBe('upd-email-new@example.org');
    const priv = (await db.doc(paths.memberPrivate(target)).get()).data() as MemberPrivate;
    expect(priv.emailLower).toBe('upd-email-new@example.org');
    await expect(auth.getUserByEmail('upd-email-old@example.org')).rejects.toBeDefined();
    expect(await notificationsFor(target, 'security')).toHaveLength(1);
  });

  it('refuses an email another member already has and leaves everything untouched', async () => {
    const admin = await makeMember('upd-clash-admin@example.org', { role: 'admin' });
    const target = await makeMember('upd-clash-target@example.org');
    await makeMember('upd-clash-other@example.org');

    await expect(
      updateMemberHandler(
        fakeCallableRequest<UpdateMemberInput>(
          { memberId: target, patch: { email: 'upd-clash-other@example.org' } },
          { uid: admin },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    expect((await auth.getUser(target)).email).toBe('upd-clash-target@example.org');
    const m = (await db.doc(cp.member(target)).get()).data() as Member;
    expect(m.email).toBe('upd-clash-target@example.org');
  });

  it('is a no-op when the patch matches what is stored', async () => {
    const admin = await makeMember('upd-noop-admin@example.org', { role: 'admin' });
    const target = await makeMember('upd-noop-target@example.org', { firstName: 'Same', lastName: 'Name' });
    const before = (await db.doc(cp.member(target)).get()).data() as Member;

    const result = await updateMemberHandler(
      fakeCallableRequest<UpdateMemberInput>(
        { memberId: target, patch: { firstName: 'Same', email: 'upd-noop-target@example.org' } },
        { uid: admin },
      ),
    );

    expect(result.changed).toBe(false);
    const after = (await db.doc(cp.member(target)).get()).data() as Member;
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it('is admin-only, 404s an unknown member, and cannot touch role or active', async () => {
    const admin = await makeMember('upd-guard-admin@example.org', { role: 'admin' });
    const member = await makeMember('upd-guard-member@example.org');

    await expect(
      updateMemberHandler(
        fakeCallableRequest<UpdateMemberInput>({ memberId: admin, patch: { firstName: 'Hacked' } }, { uid: member }),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });

    await expect(
      updateMemberHandler(
        fakeCallableRequest<UpdateMemberInput>({ memberId: 'no-such-member', patch: { firstName: 'X' } }, { uid: admin }),
      ),
    ).rejects.toMatchObject({ code: 'not-found' });

    await expect(
      updateMemberHandler(
        fakeCallableRequest(
          { memberId: member, patch: { role: 'admin', active: false } } as unknown as UpdateMemberInput,
          { uid: admin },
        ),
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

describe('club scoping (plan §21 B14, stage 1a)', () => {
  it('acts in the default club when clubId is absent or names it, and refuses an unknown club', async () => {
    const admin = await makeMember('club-scope-admin@example.org', { role: 'admin' });
    const target = await makeMember('club-scope-target@example.org');

    const implicit = await updateMemberHandler(
      fakeCallableRequest<UpdateMemberInput>({ memberId: target, patch: { phone: '09 111 1111' } }, { uid: admin }),
    );
    expect(implicit.member.phone).toBe('09 111 1111');

    const explicit = await updateMemberHandler(
      fakeCallableRequest<UpdateMemberInput>(
        { clubId: 'orewa', memberId: target, patch: { phone: '09 222 2222' } },
        { uid: admin },
      ),
    );
    expect(explicit.member.phone).toBe('09 222 2222');

    // The path builders do not include the club yet, so an unknown club must
    // be refused outright rather than quietly run against the default club.
    await expect(
      updateMemberHandler(
        fakeCallableRequest<UpdateMemberInput>(
          { clubId: 'some-other-club', memberId: target, patch: { phone: '09 333 3333' } },
          { uid: admin },
        ),
      ),
    ).rejects.toMatchObject({ code: 'not-found' });
    expect(((await db.doc(cp.member(target)).get()).data() as Member).phone).toBe('09 222 2222');

    // A clubId that is not a slug never reaches a path.
    await expect(
      updateMemberHandler(
        fakeCallableRequest<UpdateMemberInput>(
          { clubId: '../members', memberId: target, patch: { phone: '09 444 4444' } },
          { uid: admin },
        ),
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

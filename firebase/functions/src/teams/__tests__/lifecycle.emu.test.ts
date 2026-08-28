import { describe, expect, it } from 'vitest';
import {
  type AddVisitorToTeamInput,
  type CreateTeamInput,
  type CreateVisitorInput,
  type DisbandTeamInput,
  type InviteToTeamInput,
  type LeaveTeamInput,
  type RemoveFromTeamInput,
  type RemoveVisitorFromTeamInput,
  type RespondToInviteInput,
  type TransferCaptaincyInput,
} from '@obc/shared';
import {
  assertTeamValid,
  entriesForTeam,
  fakeCallableRequest,
  makeMember,
  makeProgramme,
  notificationsFor,
  sessionInFuture,
} from '../../testing/fixtures.js';
import { respondToInviteHandler } from '../../entries/invites.js';
import { createVisitorHandler } from '../../visitors/visitors.js';
import {
  addVisitorToTeamHandler,
  createTeamHandler,
  disbandTeamHandler,
  inviteToTeamHandler,
  leaveTeamHandler,
  removeFromTeamHandler,
  removeVisitorFromTeamHandler,
  transferCaptaincyHandler,
} from '../teams.js';

async function makeTeamWithMember(seriesOpts: { teamMin?: number; teamMax?: number } = {}) {
  const captain = await makeMember(`lc-captain-${Math.random().toString(36).slice(2)}@example.org`);
  const member = await makeMember(`lc-member-${Math.random().toString(36).slice(2)}@example.org`);
  const prog = await makeProgramme({
    seriesFormat: 'Teams',
    teamMin: seriesOpts.teamMin ?? 2,
    teamMax: seriesOpts.teamMax ?? 6,
    dates: [sessionInFuture('monday'), sessionInFuture('monday', 5)],
  });
  const created = await createTeamHandler(
    fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }),
  );
  const invite = await inviteToTeamHandler(
    fakeCallableRequest<InviteToTeamInput>({ teamId: created.team.id, toMemberId: member }, { uid: captain }),
  );
  await respondToInviteHandler(
    fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.invite.id, accept: true }, { uid: member }),
  );
  return { captain, member, prog, teamId: created.team.id };
}

describe('addVisitorToTeam / removeVisitorFromTeam', () => {
  it('adds a visitor with no entries, and counts them toward teamMax', async () => {
    const captain = await makeMember('team-visitor-captain@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', teamMax: 2, dates: [sessionInFuture('monday')] });
    const created = await createTeamHandler(
      fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }),
    );
    const visitor = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>({ displayName: 'Vera Visitor' }, { uid: captain }),
    );

    const result = await addVisitorToTeamHandler(
      fakeCallableRequest<AddVisitorToTeamInput>({ teamId: created.team.id, visitorId: visitor.visitor.id }, { uid: captain }),
    );
    expect(result.team.members).toHaveLength(2);
    expect(result.team.members.some((m) => m.ref.kind === 'visitor' && m.ref.visitorId === visitor.visitor.id)).toBe(true);
    expect(await entriesForTeam(created.team.id)).toHaveLength(1); // only the captain has an entry
    await assertTeamValid(created.team.id);

    const anotherVisitor = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>({ displayName: 'Second Visitor' }, { uid: captain }),
    );
    await expect(
      addVisitorToTeamHandler(
        fakeCallableRequest<AddVisitorToTeamInput>({ teamId: created.team.id, visitorId: anotherVisitor.visitor.id }, { uid: captain }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' }); // teamMax=2 already reached
  });

  it('rejects a visitor not owned by the captain', async () => {
    const captain = await makeMember('team-visitor-perm-captain@example.org');
    const otherMember = await makeMember('team-visitor-perm-other@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInFuture('monday')] });
    const created = await createTeamHandler(
      fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }),
    );
    const visitor = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>({ displayName: 'Not Yours' }, { uid: otherMember }),
    );

    await expect(
      addVisitorToTeamHandler(
        fakeCallableRequest<AddVisitorToTeamInput>({ teamId: created.team.id, visitorId: visitor.visitor.id }, { uid: captain }),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('removes a visitor from the team', async () => {
    const captain = await makeMember('team-visitor-remove-captain@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInFuture('monday')] });
    const created = await createTeamHandler(
      fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }),
    );
    const visitor = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>({ displayName: 'Leaving Visitor' }, { uid: captain }),
    );
    await addVisitorToTeamHandler(
      fakeCallableRequest<AddVisitorToTeamInput>({ teamId: created.team.id, visitorId: visitor.visitor.id }, { uid: captain }),
    );

    const result = await removeVisitorFromTeamHandler(
      fakeCallableRequest<RemoveVisitorFromTeamInput>({ teamId: created.team.id, visitorId: visitor.visitor.id }, { uid: captain }),
    );
    expect(result.team.members).toHaveLength(1);
    await assertTeamValid(created.team.id);
  });
});

describe('leaveTeam', () => {
  it('lets a non-captain leave, cancelling their future entries', async () => {
    const { member, teamId } = await makeTeamWithMember();

    const result = await leaveTeamHandler(fakeCallableRequest<LeaveTeamInput>({ teamId }, { uid: member }));
    expect(result.team.members.some((m) => m.ref.kind === 'member' && m.ref.memberId === member)).toBe(false);
    const { entries } = await assertTeamValid(teamId);
    expect(entries.filter((e) => e.memberId === member).every((e) => e.status === 'cancelled')).toBe(true);
  });

  it('notifies the captain', async () => {
    const { captain, member, teamId } = await makeTeamWithMember();
    await leaveTeamHandler(fakeCallableRequest<LeaveTeamInput>({ teamId }, { uid: member }));
    expect(await notificationsFor(captain, 'team_member_left')).toHaveLength(1);
  });

  it('refuses the captain', async () => {
    const { captain, teamId } = await makeTeamWithMember();
    await expect(leaveTeamHandler(fakeCallableRequest<LeaveTeamInput>({ teamId }, { uid: captain }))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });
});

describe('removeFromTeam', () => {
  it('captain removes a member: entries cancelled and the member notified', async () => {
    const { captain, member, teamId } = await makeTeamWithMember();

    const result = await removeFromTeamHandler(
      fakeCallableRequest<RemoveFromTeamInput>({ teamId, ref: { kind: 'member', memberId: member } }, { uid: captain }),
    );
    expect(result.team.members.some((m) => m.ref.kind === 'member' && m.ref.memberId === member)).toBe(false);
    const { entries } = await assertTeamValid(teamId);
    expect(entries.filter((e) => e.memberId === member).every((e) => e.status === 'cancelled')).toBe(true);
    expect(await notificationsFor(member, 'team_removed')).toHaveLength(1);
  });

  it('the captain cannot remove themselves', async () => {
    const { captain, teamId } = await makeTeamWithMember();
    await expect(
      removeFromTeamHandler(
        fakeCallableRequest<RemoveFromTeamInput>({ teamId, ref: { kind: 'member', memberId: captain } }, { uid: captain }),
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects a non-captain', async () => {
    const { member, teamId } = await makeTeamWithMember();
    await expect(
      removeFromTeamHandler(
        fakeCallableRequest<RemoveFromTeamInput>({ teamId, ref: { kind: 'member', memberId: member } }, { uid: member }),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('transferCaptaincy', () => {
  it('offer then accept flips the captain', async () => {
    const { captain, member, teamId } = await makeTeamWithMember();

    const offer = await transferCaptaincyHandler(
      fakeCallableRequest<TransferCaptaincyInput>({ teamId, toMemberId: member }, { uid: captain }),
    );
    expect(offer.invite.kind).toBe('captaincy');
    expect(await notificationsFor(member, 'team_captaincy_offered')).toHaveLength(1);

    await respondToInviteHandler(
      fakeCallableRequest<RespondToInviteInput>({ inviteId: offer.invite.id, accept: true }, { uid: member }),
    );

    const { team } = await assertTeamValid(teamId);
    expect(team.captainMemberId).toBe(member);
    expect(await notificationsFor(captain, 'team_captaincy_transferred')).toHaveLength(1);
  });

  it('decline leaves the captaincy unchanged', async () => {
    const { captain, member, teamId } = await makeTeamWithMember();
    const offer = await transferCaptaincyHandler(
      fakeCallableRequest<TransferCaptaincyInput>({ teamId, toMemberId: member }, { uid: captain }),
    );
    await respondToInviteHandler(
      fakeCallableRequest<RespondToInviteInput>({ inviteId: offer.invite.id, accept: false }, { uid: member }),
    );
    const { team } = await assertTeamValid(teamId);
    expect(team.captainMemberId).toBe(captain);
  });

  it('rejects a target who is not on the team', async () => {
    const { captain, teamId } = await makeTeamWithMember();
    const outsider = await makeMember('team-transfer-outsider@example.org');
    await expect(
      transferCaptaincyHandler(fakeCallableRequest<TransferCaptaincyInput>({ teamId, toMemberId: outsider }, { uid: captain })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

describe('disbandTeam', () => {
  it('cancels entries, expires pending invites, notifies every member', async () => {
    const { captain, member, prog, teamId } = await makeTeamWithMember();
    const thirdMember = await makeMember('team-disband-pending-invitee@example.org');
    const pendingInvite = await inviteToTeamHandler(
      fakeCallableRequest<InviteToTeamInput>({ teamId, toMemberId: thirdMember }, { uid: captain }),
    );
    void prog;

    const result = await disbandTeamHandler(fakeCallableRequest<DisbandTeamInput>({ teamId }, { uid: captain }));
    expect(result.team.status).toBe('disbanded');

    const { entries } = await assertTeamValid(teamId);
    expect(entries.every((e) => e.status === 'cancelled')).toBe(true);
    expect(await notificationsFor(captain, 'team_disbanded')).toHaveLength(1);
    expect(await notificationsFor(member, 'team_disbanded')).toHaveLength(1);

    await expect(
      respondToInviteHandler(
        fakeCallableRequest<RespondToInviteInput>({ inviteId: pendingInvite.invite.id, accept: true }, { uid: thirdMember }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects further mutations on a disbanded team', async () => {
    const { captain, teamId } = await makeTeamWithMember();
    await disbandTeamHandler(fakeCallableRequest<DisbandTeamInput>({ teamId }, { uid: captain }));

    await expect(disbandTeamHandler(fakeCallableRequest<DisbandTeamInput>({ teamId }, { uid: captain }))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    const outsider = await makeMember('team-disband-invite-after@example.org');
    await expect(
      inviteToTeamHandler(fakeCallableRequest<InviteToTeamInput>({ teamId, toMemberId: outsider }, { uid: captain })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

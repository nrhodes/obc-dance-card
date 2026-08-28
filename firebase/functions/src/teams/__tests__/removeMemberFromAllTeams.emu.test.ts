import { describe, expect, it } from 'vitest';
import type { CreateTeamInput, InviteToTeamInput, RespondToInviteInput } from '@obc/shared';
import { assertTeamValid, fakeCallableRequest, makeMember, makeProgramme, notificationsFor, sessionInFuture } from '../../testing/fixtures.js';
import { respondToInviteHandler } from '../../entries/invites.js';
import { removeMemberFromAllTeams } from '../lib.js';
import { createTeamHandler, inviteToTeamHandler } from '../teams.js';

describe('removeMemberFromAllTeams (Phase 6 hook, exercised directly)', () => {
  it('transfers captaincy to the earliest-joined remaining member', async () => {
    const captain = await makeMember('rmat-captain@example.org');
    const early = await makeMember('rmat-early@example.org');
    const late = await makeMember('rmat-late@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', teamMin: 2, dates: [sessionInFuture('monday')] });
    const created = await createTeamHandler(fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }));

    const inviteEarly = await inviteToTeamHandler(
      fakeCallableRequest<InviteToTeamInput>({ teamId: created.team.id, toMemberId: early }, { uid: captain }),
    );
    await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: inviteEarly.invite.id, accept: true }, { uid: early }));
    const inviteLate = await inviteToTeamHandler(
      fakeCallableRequest<InviteToTeamInput>({ teamId: created.team.id, toMemberId: late }, { uid: captain }),
    );
    await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: inviteLate.invite.id, accept: true }, { uid: late }));

    await removeMemberFromAllTeams(captain);

    const { team, entries } = await assertTeamValid(created.team.id);
    expect(team.captainMemberId).toBe(early);
    expect(entries.filter((e) => e.memberId === captain).every((e) => e.status === 'cancelled')).toBe(true);
    expect(await notificationsFor(early, 'team_captaincy_transferred')).toHaveLength(1);
  });

  it('disbands the team when the captain was the sole member', async () => {
    const captain = await makeMember('rmat-sole-captain@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInFuture('monday')] });
    const created = await createTeamHandler(fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }));

    await removeMemberFromAllTeams(captain);

    const { team } = await assertTeamValid(created.team.id);
    expect(team.status).toBe('disbanded');
  });

  it('a non-captain member is simply removed, with their future entries cancelled', async () => {
    const captain = await makeMember('rmat-member-captain@example.org');
    const member = await makeMember('rmat-member-plain@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', teamMin: 2, dates: [sessionInFuture('monday')] });
    const created = await createTeamHandler(fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }));
    const invite = await inviteToTeamHandler(
      fakeCallableRequest<InviteToTeamInput>({ teamId: created.team.id, toMemberId: member }, { uid: captain }),
    );
    await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.invite.id, accept: true }, { uid: member }));

    await removeMemberFromAllTeams(member);

    const { team, entries } = await assertTeamValid(created.team.id);
    expect(team.captainMemberId).toBe(captain);
    expect(team.members.some((m) => m.ref.kind === 'member' && m.ref.memberId === member)).toBe(false);
    expect(entries.filter((e) => e.memberId === member).every((e) => e.status === 'cancelled')).toBe(true);
  });
});

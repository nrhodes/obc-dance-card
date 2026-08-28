import { describe, expect, it } from 'vitest';
import { paths, type CreateTeamInput, type Invite, type InviteToTeamInput, type RespondToInviteInput } from '@obc/shared';
import { db } from '../../lib/admin.js';
import {
  assertTeamValid,
  fakeCallableRequest,
  makeMember,
  makeProgramme,
  notificationsFor,
  sessionInFuture,
} from '../../testing/fixtures.js';
import { respondToInviteHandler } from '../../entries/invites.js';
import { createTeamHandler, inviteToTeamHandler } from '../teams.js';

describe('inviteToTeam', () => {
  it('creates a pending team invite and notifies the invitee', async () => {
    const captain = await makeMember('team-invite-captain@example.org');
    const invitee = await makeMember('team-invite-to@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInFuture('monday')] });
    const created = await createTeamHandler(
      fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }),
    );

    const result = await inviteToTeamHandler(
      fakeCallableRequest<InviteToTeamInput>({ teamId: created.team.id, toMemberId: invitee }, { uid: captain }),
    );

    expect(result.invite.scope).toBe('team');
    expect(result.invite.kind).toBe('join');
    expect(result.invite.teamId).toBe(created.team.id);
    expect(result.invite.fromMemberId).toBe(captain);
    expect(result.invite.toMemberId).toBe(invitee);
    expect(await notificationsFor(invitee, 'team_invite_received')).toHaveLength(1);
  });

  it('rejects a non-captain', async () => {
    const captain = await makeMember('team-invite-perm-captain@example.org');
    const notCaptain = await makeMember('team-invite-perm-notcaptain@example.org');
    const invitee = await makeMember('team-invite-perm-to@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInFuture('monday')] });
    const created = await createTeamHandler(
      fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }),
    );

    await expect(
      inviteToTeamHandler(
        fakeCallableRequest<InviteToTeamInput>({ teamId: created.team.id, toMemberId: invitee }, { uid: notCaptain }),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects when the team is full', async () => {
    const captain = await makeMember('team-invite-full-captain@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', teamMax: 1, dates: [sessionInFuture('monday')] });
    const created = await createTeamHandler(
      fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }),
    );
    const invitee = await makeMember('team-invite-full-to@example.org');

    await expect(
      inviteToTeamHandler(
        fakeCallableRequest<InviteToTeamInput>({ teamId: created.team.id, toMemberId: invitee }, { uid: captain }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects an invitee already on a team in the series', async () => {
    const captainA = await makeMember('team-invite-elsewhere-a@example.org');
    const captainB = await makeMember('team-invite-elsewhere-b@example.org');
    const member = await makeMember('team-invite-elsewhere-m@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', teamMax: 6, dates: [sessionInFuture('monday')] });
    const teamA = await createTeamHandler(
      fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captainA }),
    );
    const teamB = await createTeamHandler(
      fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captainB }),
    );
    const inviteA = await inviteToTeamHandler(
      fakeCallableRequest<InviteToTeamInput>({ teamId: teamA.team.id, toMemberId: member }, { uid: captainA }),
    );
    await respondToInviteHandler(
      fakeCallableRequest<RespondToInviteInput>({ inviteId: inviteA.invite.id, accept: true }, { uid: member }),
    );

    await expect(
      inviteToTeamHandler(
        fakeCallableRequest<InviteToTeamInput>({ teamId: teamB.team.id, toMemberId: member }, { uid: captainB }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects an invitee busy on one of the team sessions', async () => {
    const captain = await makeMember('team-invite-busy-captain@example.org');
    const invitee = await makeMember('team-invite-busy-to@example.org');
    const date = sessionInFuture('monday');
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [date] });
    const created = await createTeamHandler(
      fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }),
    );
    // Directly seed a non-team entry for the invitee at the exact session id
    // this team needs — the simplest way to make them "busy" there.
    const busyId = `${prog.sessionIds[0]}_${invitee}`;
    const now = new Date().toISOString();
    await db.doc(paths.entry(busyId)).set({
      id: busyId,
      sessionId: prog.sessionIds[0],
      date,
      weekday: 'monday',
      seriesId: prog.seriesId,
      memberId: invitee,
      status: 'available',
      partner: null,
      pairingId: null,
      teamId: null,
      teamSessionOnly: false,
      substitute: null,
      partnerSubstitute: null,
      isSubstituteFor: null,
      createdBy: invitee,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      inviteToTeamHandler(
        fakeCallableRequest<InviteToTeamInput>({ teamId: created.team.id, toMemberId: invitee }, { uid: captain }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

describe('respondToInvite (team, kind=join)', () => {
  it('accepts: adds the member, creates entries for every session, notifies the captain', async () => {
    const captain = await makeMember('team-join-captain@example.org');
    const invitee = await makeMember('team-join-to@example.org');
    const prog = await makeProgramme({
      seriesFormat: 'Teams',
      teamMin: 2,
      dates: [sessionInFuture('monday'), sessionInFuture('monday', 5)],
    });
    const created = await createTeamHandler(
      fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }),
    );
    const invite = await inviteToTeamHandler(
      fakeCallableRequest<InviteToTeamInput>({ teamId: created.team.id, toMemberId: invitee }, { uid: captain }),
    );

    const result = await respondToInviteHandler(
      fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.invite.id, accept: true }, { uid: invitee }),
    );

    expect(result.invite.status).toBe('accepted');
    expect(result.entries).toHaveLength(2);
    expect(result.team?.status).toBe('active'); // teamMin=2 reached
    const { team } = await assertTeamValid(created.team.id);
    expect(team.members.some((m) => m.ref.kind === 'member' && m.ref.memberId === invitee)).toBe(true);
    expect(await notificationsFor(captain, 'team_member_joined')).toHaveLength(1);
  });

  it('declining notifies the captain and leaves the team unchanged', async () => {
    const captain = await makeMember('team-decline-captain@example.org');
    const invitee = await makeMember('team-decline-to@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInFuture('monday')] });
    const created = await createTeamHandler(
      fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }),
    );
    const invite = await inviteToTeamHandler(
      fakeCallableRequest<InviteToTeamInput>({ teamId: created.team.id, toMemberId: invitee }, { uid: captain }),
    );

    const result = await respondToInviteHandler(
      fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.invite.id, accept: false }, { uid: invitee }),
    );

    expect(result.invite.status).toBe('declined');
    expect(await notificationsFor(captain, 'team_member_declined')).toHaveLength(1);
    const { team } = await assertTeamValid(created.team.id);
    expect(team.members).toHaveLength(1);
  });

  it('rejects accepting into a full team', async () => {
    const captain = await makeMember('team-join-full-captain@example.org');
    const invitee = await makeMember('team-join-full-to@example.org');
    const filler = await makeMember('team-join-full-filler@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', teamMax: 2, dates: [sessionInFuture('monday')] });
    const created = await createTeamHandler(
      fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }),
    );
    const inviteToInvitee = await inviteToTeamHandler(
      fakeCallableRequest<InviteToTeamInput>({ teamId: created.team.id, toMemberId: invitee }, { uid: captain }),
    );
    const inviteToFiller = await inviteToTeamHandler(
      fakeCallableRequest<InviteToTeamInput>({ teamId: created.team.id, toMemberId: filler }, { uid: captain }),
    );
    // Filler fills the one remaining slot (teamMax=2: captain + filler).
    await respondToInviteHandler(
      fakeCallableRequest<RespondToInviteInput>({ inviteId: inviteToFiller.invite.id, accept: true }, { uid: filler }),
    );

    await expect(
      respondToInviteHandler(
        fakeCallableRequest<RespondToInviteInput>({ inviteId: inviteToInvitee.invite.id, accept: true }, { uid: invitee }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects when the invitee joined another team in the series meanwhile', async () => {
    const captainA = await makeMember('team-join-race-a@example.org');
    const captainB = await makeMember('team-join-race-b@example.org');
    const invitee = await makeMember('team-join-race-to@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInFuture('monday')] });
    const teamA = await createTeamHandler(
      fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captainA }),
    );
    const teamB = await createTeamHandler(
      fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captainB }),
    );
    const inviteA = await inviteToTeamHandler(
      fakeCallableRequest<InviteToTeamInput>({ teamId: teamA.team.id, toMemberId: invitee }, { uid: captainA }),
    );
    const inviteB = await inviteToTeamHandler(
      fakeCallableRequest<InviteToTeamInput>({ teamId: teamB.team.id, toMemberId: invitee }, { uid: captainB }),
    );

    await respondToInviteHandler(
      fakeCallableRequest<RespondToInviteInput>({ inviteId: inviteA.invite.id, accept: true }, { uid: invitee }),
    );
    await expect(
      respondToInviteHandler(
        fakeCallableRequest<RespondToInviteInput>({ inviteId: inviteB.invite.id, accept: true }, { uid: invitee }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('exactly one of two concurrent accepts succeeds for the last slot', async () => {
    const captain = await makeMember('team-join-conc-captain@example.org');
    const a = await makeMember('team-join-conc-a@example.org');
    const b = await makeMember('team-join-conc-b@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', teamMax: 2, dates: [sessionInFuture('monday')] });
    const created = await createTeamHandler(
      fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }),
    );
    const inviteA = await inviteToTeamHandler(
      fakeCallableRequest<InviteToTeamInput>({ teamId: created.team.id, toMemberId: a }, { uid: captain }),
    );
    const inviteB = await inviteToTeamHandler(
      fakeCallableRequest<InviteToTeamInput>({ teamId: created.team.id, toMemberId: b }, { uid: captain }),
    );

    const settled = await Promise.allSettled([
      respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: inviteA.invite.id, accept: true }, { uid: a })),
      respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: inviteB.invite.id, accept: true }, { uid: b })),
    ]);

    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const { team } = await assertTeamValid(created.team.id);
    expect(team.members).toHaveLength(2);
  });

  it('expires a competing pending invite for the invitee on an overlapping session', async () => {
    const captain = await makeMember('team-join-expire-captain@example.org');
    const otherSender = await makeMember('team-join-expire-other@example.org');
    const invitee = await makeMember('team-join-expire-to@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInFuture('monday')] });
    const created = await createTeamHandler(
      fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }),
    );
    const teamInvite = await inviteToTeamHandler(
      fakeCallableRequest<InviteToTeamInput>({ teamId: created.team.id, toMemberId: invitee }, { uid: captain }),
    );

    // A pairs series with the *same* session id would be a different
    // document; instead simulate a competing invite by seeding one for the
    // exact session this team invite covers.
    const now = new Date().toISOString();
    const competingId = 'competing-invite-1';
    const competing: Invite = {
      id: competingId,
      scope: 'session',
      year: prog.year,
      sessionIds: [prog.sessionIds[0]!],
      seriesId: null,
      teamId: null,
      fromMemberId: otherSender,
      toMemberId: invitee,
      status: 'pending',
      createdBy: otherSender,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      createdAt: now,
      updatedAt: now,
    };
    await db.doc(paths.invite(competingId)).set(competing);

    await respondToInviteHandler(
      fakeCallableRequest<RespondToInviteInput>({ inviteId: teamInvite.invite.id, accept: true }, { uid: invitee }),
    );

    const competingSnap = await db.doc(paths.invite(competingId)).get();
    expect((competingSnap.data() as Invite).status).toBe('expired');
  });
});

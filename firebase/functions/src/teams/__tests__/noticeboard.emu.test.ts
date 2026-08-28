import { describe, expect, it } from 'vitest';
import type { ClaimLookingForPartnerInput, CreateTeamInput, SetSoloStatusInput } from '@obc/shared';
import { assertTeamValid, fakeCallableRequest, makeMember, makeProgramme, notificationsFor, sessionInFuture } from '../../testing/fixtures.js';
import { claimLookingForPartnerHandler, setSoloStatusHandler } from '../../entries/entries.js';
import { createTeamHandler } from '../teams.js';

describe('setSoloStatus on a Teams session', () => {
  it('posts "looking for a team"', async () => {
    const member = await makeMember('teams-solo-lfp@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInFuture('monday')] });

    const result = await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>(
        { year: prog.year, sessionId: prog.sessionIds[0]!, status: 'looking_for_partner' },
        { uid: member },
      ),
    );
    expect(result.entry.status).toBe('looking_for_partner');
    expect(result.entry.teamId).toBeNull();
  });

  it('posts "available for a team"', async () => {
    const member = await makeMember('teams-solo-avail@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInFuture('monday')] });

    const result = await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>({ year: prog.year, sessionId: prog.sessionIds[0]!, status: 'available' }, { uid: member }),
    );
    expect(result.entry.status).toBe('available');
  });
});

describe('claimLookingForPartner on a Teams session', () => {
  it('a captain with space claims the poster onto their team for the whole series', async () => {
    const captain = await makeMember('teams-claim-captain@example.org');
    const poster = await makeMember('teams-claim-poster@example.org');
    const prog = await makeProgramme({
      seriesFormat: 'Teams',
      dates: [sessionInFuture('monday'), sessionInFuture('monday', 5)],
    });
    const created = await createTeamHandler(fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }));
    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>(
        { year: prog.year, sessionId: prog.sessionIds[0]!, status: 'looking_for_partner' },
        { uid: poster },
      ),
    );

    const result = await claimLookingForPartnerHandler(
      fakeCallableRequest<ClaimLookingForPartnerInput>(
        { year: prog.year, sessionId: prog.sessionIds[0]!, posterMemberId: poster },
        { uid: captain },
      ),
    );

    expect(result.entries).toHaveLength(2); // one entry per series session
    expect(result.entries.every((e) => e.teamId === created.team.id)).toBe(true);
    const { team } = await assertTeamValid(created.team.id);
    expect(team.members.some((m) => m.ref.kind === 'member' && m.ref.memberId === poster)).toBe(true);
    expect(await notificationsFor(poster, 'claimed')).toHaveLength(1);
  });

  it('rejects a non-captain claiming', async () => {
    const notCaptain = await makeMember('teams-claim-notcaptain@example.org');
    const poster = await makeMember('teams-claim-poster2@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInFuture('monday')] });
    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>(
        { year: prog.year, sessionId: prog.sessionIds[0]!, status: 'looking_for_partner' },
        { uid: poster },
      ),
    );

    await expect(
      claimLookingForPartnerHandler(
        fakeCallableRequest<ClaimLookingForPartnerInput>(
          { year: prog.year, sessionId: prog.sessionIds[0]!, posterMemberId: poster },
          { uid: notCaptain },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects a captain whose team is full', async () => {
    const captain = await makeMember('teams-claim-full-captain@example.org');
    const poster = await makeMember('teams-claim-full-poster@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', teamMax: 1, dates: [sessionInFuture('monday')] });
    await createTeamHandler(fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }));
    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>(
        { year: prog.year, sessionId: prog.sessionIds[0]!, status: 'looking_for_partner' },
        { uid: poster },
      ),
    );

    await expect(
      claimLookingForPartnerHandler(
        fakeCallableRequest<ClaimLookingForPartnerInput>(
          { year: prog.year, sessionId: prog.sessionIds[0]!, posterMemberId: poster },
          { uid: captain },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

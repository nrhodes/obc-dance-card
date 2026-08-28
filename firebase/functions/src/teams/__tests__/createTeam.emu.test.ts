import { describe, expect, it } from 'vitest';
import type { CreateTeamInput, SetSoloStatusInput } from '@obc/shared';
import {
  assertTeamValid,
  fakeCallableRequest,
  makeMember,
  makeProgramme,
  sessionInFuture,
  sessionInPast,
} from '../../testing/fixtures.js';
import { setSoloStatusHandler } from '../../entries/entries.js';
import { createTeamHandler } from '../teams.js';

describe('createTeam', () => {
  it('creates a forming team with the captain entered on every unlocked session', async () => {
    const captain = await makeMember('create-team-a@example.org', { lastName: 'Anderson' });
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInFuture('monday'), sessionInFuture('monday', 5)] });

    const result = await createTeamHandler(
      fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }),
    );

    expect(result.team.status).toBe('forming');
    expect(result.team.captainMemberId).toBe(captain);
    expect(result.team.members).toHaveLength(1);
    expect(result.team.name).toBe('Anderson team');
    expect(result.entries).toHaveLength(2);
    for (const entry of result.entries) {
      expect(entry.status).toBe('confirmed');
      expect(entry.teamId).toBe(result.team.id);
      expect(entry.partner).toBeNull();
      expect(entry.pairingId).toBeNull();
    }
    await assertTeamValid(result.team.id);
  });

  it('honours a custom name', async () => {
    const captain = await makeMember('create-team-name@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInFuture('monday')] });

    const result = await createTeamHandler(
      fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId, name: 'The Sharks' }, { uid: captain }),
    );

    expect(result.team.name).toBe('The Sharks');
  });

  it('rejects a non-Teams series', async () => {
    const captain = await makeMember('create-team-notteams@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Pairs', dates: [sessionInFuture('monday')] });

    await expect(
      createTeamHandler(fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects when every session has already started', async () => {
    const captain = await makeMember('create-team-locked@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInPast('monday')] });

    await expect(
      createTeamHandler(fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects a captain who already has an entry on one of the series sessions', async () => {
    const captain = await makeMember('create-team-busy@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInFuture('monday')] });

    // A Teams session's noticeboard listing ("looking for a team") still
    // occupies the member's entry for that session — createTeam must see it.
    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>(
        { year: prog.year, sessionId: prog.sessionIds[0]!, status: 'looking_for_partner' },
        { uid: captain },
      ),
    );

    await expect(
      createTeamHandler(fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects a second team by the same captain in the same series', async () => {
    const captain = await makeMember('create-team-dup@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInFuture('monday'), sessionInFuture('monday', 5)] });

    await createTeamHandler(fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }));

    await expect(
      createTeamHandler(fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

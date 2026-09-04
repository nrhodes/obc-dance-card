/**
 * App-Store-review cohort partition (plan §8.1, decided 2026-09-05) —
 * emulator-level coverage of the cross-cohort preconditions added to
 * `sendInvite`, `claimLookingForPartner`, `inviteToTeam`, and of the
 * same-cohort review↔review path stamping `cohort` on created docs.
 * `firebase/functions/rules-test/*.rules.test.ts` covers the Firestore rules
 * side (query provability); `shared/src/pairing.test.ts` covers the
 * cross-cohort invariant inside `validatePairingGroup`/`validateTeamGroup`
 * directly (pure, no I/O — the natural place for it, since every callable
 * path here is already guarded before a mixed-cohort group could ever reach
 * those validators).
 */
import { describe, expect, it } from 'vitest';
import type {
  ClaimLookingForPartnerInput,
  CreateTeamInput,
  InviteToTeamInput,
  RespondToInviteInput,
  SendInviteInput,
  SetSoloStatusInput,
} from '@obc/shared';
import {
  assertSessionPairingValid,
  fakeCallableRequest,
  makeMember,
  makeProgramme,
  sessionInFuture,
} from '../../testing/fixtures.js';
import { claimLookingForPartnerHandler, setSoloStatusHandler } from '../entries.js';
import { respondToInviteHandler, sendInviteHandler } from '../invites.js';
import { createTeamHandler, inviteToTeamHandler } from '../../teams/teams.js';

describe('cohort partition — sendInvite', () => {
  it('rejects a club member inviting a review member', async () => {
    const club = await makeMember('cohort-invite-club@example.org', { cohort: 'club' });
    const review = await makeMember('cohort-invite-review@example.org', { cohort: 'review' });
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    await expect(
      sendInviteHandler(
        fakeCallableRequest<SendInviteInput>(
          { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0], toMemberId: review },
          { uid: club },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects a review member inviting a club member', async () => {
    const club = await makeMember('cohort-invite-club2@example.org', { cohort: 'club' });
    const review = await makeMember('cohort-invite-review2@example.org', { cohort: 'review' });
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    await expect(
      sendInviteHandler(
        fakeCallableRequest<SendInviteInput>(
          { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0], toMemberId: club },
          { uid: review },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('review↔review invite/accept works end to end and stamps cohort on the created entries', async () => {
    const r1 = await makeMember('cohort-review-r1@example.org', { cohort: 'review' });
    const r2 = await makeMember('cohort-review-r2@example.org', { cohort: 'review' });
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    const { invite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0], toMemberId: r2 },
        { uid: r1 },
      ),
    );
    const { entries } = await respondToInviteHandler(
      fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.id, accept: true }, { uid: r2 }),
    );

    expect(entries).toHaveLength(2);
    for (const e of entries) expect(e.cohort).toBe('review');
    await assertSessionPairingValid(prog.sessionIds[0]!);
  });
});

describe('cohort partition — claimLookingForPartner', () => {
  it('rejects a club member claiming a review member’s listing', async () => {
    const review = await makeMember('cohort-claim-review@example.org', { cohort: 'review' });
    const club = await makeMember('cohort-claim-club@example.org', { cohort: 'club' });
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>(
        { year: prog.year, sessionId: prog.sessionIds[0]!, status: 'looking_for_partner' },
        { uid: review },
      ),
    );

    await expect(
      claimLookingForPartnerHandler(
        fakeCallableRequest<ClaimLookingForPartnerInput>(
          { year: prog.year, sessionId: prog.sessionIds[0]!, posterMemberId: review },
          { uid: club },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

describe('cohort partition — inviteToTeam', () => {
  it('rejects a club captain inviting a review member', async () => {
    const captain = await makeMember('cohort-team-captain@example.org', { cohort: 'club' });
    const review = await makeMember('cohort-team-review@example.org', { cohort: 'review' });
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInFuture('monday')] });
    const created = await createTeamHandler(
      fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }),
    );

    await expect(
      inviteToTeamHandler(
        fakeCallableRequest<InviteToTeamInput>({ teamId: created.team.id, toMemberId: review }, { uid: captain }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('a review captain’s team is stamped cohort review, and inviting a review member succeeds', async () => {
    const captain = await makeMember('cohort-team-rcaptain@example.org', { cohort: 'review' });
    const invitee = await makeMember('cohort-team-rinvitee@example.org', { cohort: 'review' });
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInFuture('monday')] });
    const created = await createTeamHandler(
      fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }),
    );
    expect(created.team.cohort).toBe('review');
    for (const e of created.entries) expect(e.cohort).toBe('review');

    const result = await inviteToTeamHandler(
      fakeCallableRequest<InviteToTeamInput>({ teamId: created.team.id, toMemberId: invitee }, { uid: captain }),
    );
    expect(result.invite.status).toBe('pending');
  });
});

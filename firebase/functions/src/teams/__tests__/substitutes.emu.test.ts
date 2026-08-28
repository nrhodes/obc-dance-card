import { describe, expect, it } from 'vitest';
import {
  paths,
  type AddTeamSessionSubstituteInput,
  type CancelEntryInput,
  type ClearTeamSessionSubstituteInput,
  type CreateTeamInput,
  type CreateVisitorInput,
  type InviteToTeamInput,
  type RespondToInviteInput,
} from '@obc/shared';
import { db } from '../../lib/admin.js';
import { assertTeamValid, fakeCallableRequest, makeMember, makeProgramme, notificationsFor, sessionInFuture } from '../../testing/fixtures.js';
import { cancelEntryHandler } from '../../entries/entries.js';
import { entryId } from '../../entries/lib.js';
import { respondToInviteHandler } from '../../entries/invites.js';
import { createVisitorHandler } from '../../visitors/visitors.js';
import { addTeamSessionSubstituteHandler, clearTeamSessionSubstituteHandler, createTeamHandler, inviteToTeamHandler } from '../teams.js';

async function makeActiveTeamOfTwo() {
  const captain = await makeMember(`sub-captain-${Math.random().toString(36).slice(2)}@example.org`);
  const member = await makeMember(`sub-member-${Math.random().toString(36).slice(2)}@example.org`);
  const prog = await makeProgramme({ seriesFormat: 'Teams', teamMin: 2, dates: [sessionInFuture('monday')] });
  const created = await createTeamHandler(fakeCallableRequest<CreateTeamInput>({ year: prog.year, seriesId: prog.seriesId }, { uid: captain }));
  const invite = await inviteToTeamHandler(fakeCallableRequest<InviteToTeamInput>({ teamId: created.team.id, toMemberId: member }, { uid: captain }));
  await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: invite.invite.id, accept: true }, { uid: member }));
  return { captain, member, prog, teamId: created.team.id, sessionId: prog.sessionIds[0]! };
}

describe('addTeamSessionSubstitute', () => {
  it('refuses when nobody on the roster is absent for that session', async () => {
    const { captain, teamId, sessionId } = await makeActiveTeamOfTwo();
    const sub = await makeMember('team-sub-none-absent@example.org');
    await expect(
      addTeamSessionSubstituteHandler(
        fakeCallableRequest<AddTeamSessionSubstituteInput>({ teamId, sessionId, ref: { kind: 'member', memberId: sub } }, { uid: captain }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('a member substitute gets a teamSessionOnly entry once someone is absent, and notifies them', async () => {
    const { captain, member, teamId, sessionId } = await makeActiveTeamOfTwo();
    await cancelEntryHandler(fakeCallableRequest<CancelEntryInput>({ entryId: entryId(sessionId, member) }, { uid: member }));

    const sub = await makeMember('team-sub-member@example.org');
    const result = await addTeamSessionSubstituteHandler(
      fakeCallableRequest<AddTeamSessionSubstituteInput>({ teamId, sessionId, ref: { kind: 'member', memberId: sub } }, { uid: captain }),
    );
    expect(result.entry?.teamSessionOnly).toBe(true);
    expect(result.entry?.status).toBe('confirmed');
    expect(result.entry?.teamId).toBe(teamId);
    await assertTeamValid(teamId);
    expect(await notificationsFor(sub, 'substitute_arranged')).toHaveLength(1);
  });

  it('refuses a substitute who is already on the roster', async () => {
    const { captain, member, teamId, sessionId } = await makeActiveTeamOfTwo();
    await cancelEntryHandler(fakeCallableRequest<CancelEntryInput>({ entryId: entryId(sessionId, member) }, { uid: member }));

    await expect(
      addTeamSessionSubstituteHandler(
        fakeCallableRequest<AddTeamSessionSubstituteInput>({ teamId, sessionId, ref: { kind: 'member', memberId: captain } }, { uid: captain }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('a visitor substitute is recorded on the team doc, with no entry', async () => {
    const { captain, member, teamId, sessionId } = await makeActiveTeamOfTwo();
    await cancelEntryHandler(fakeCallableRequest<CancelEntryInput>({ entryId: entryId(sessionId, member) }, { uid: member }));
    const visitor = await createVisitorHandler(fakeCallableRequest<CreateVisitorInput>({ displayName: 'Vera Sub' }, { uid: captain }));

    const result = await addTeamSessionSubstituteHandler(
      fakeCallableRequest<AddTeamSessionSubstituteInput>(
        { teamId, sessionId, ref: { kind: 'visitor', visitorId: visitor.visitor.id } },
        { uid: captain },
      ),
    );
    expect(result.entry).toBeUndefined();
    expect(result.team.sessionVisitors?.[sessionId]?.some((r) => r.kind === 'visitor' && r.visitorId === visitor.visitor.id)).toBe(true);
    await assertTeamValid(teamId);

    const entrySnap = await db.doc(paths.entry(entryId(sessionId, visitor.visitor.id))).get();
    expect(entrySnap.exists).toBe(false);
  });
});

describe('clearTeamSessionSubstitute', () => {
  it('reverses a member substitute and notifies them', async () => {
    const { captain, member, teamId, sessionId } = await makeActiveTeamOfTwo();
    await cancelEntryHandler(fakeCallableRequest<CancelEntryInput>({ entryId: entryId(sessionId, member) }, { uid: member }));
    const sub = await makeMember('team-sub-clear-member@example.org');
    await addTeamSessionSubstituteHandler(
      fakeCallableRequest<AddTeamSessionSubstituteInput>({ teamId, sessionId, ref: { kind: 'member', memberId: sub } }, { uid: captain }),
    );

    const result = await clearTeamSessionSubstituteHandler(
      fakeCallableRequest<ClearTeamSessionSubstituteInput>({ teamId, sessionId, ref: { kind: 'member', memberId: sub } }, { uid: captain }),
    );
    expect(result.entry?.status).toBe('cancelled');
    await assertTeamValid(teamId);
    expect(await notificationsFor(sub, 'substitute_cleared')).toHaveLength(1);
  });

  it('reverses a visitor substitute', async () => {
    const { captain, member, teamId, sessionId } = await makeActiveTeamOfTwo();
    await cancelEntryHandler(fakeCallableRequest<CancelEntryInput>({ entryId: entryId(sessionId, member) }, { uid: member }));
    const visitor = await createVisitorHandler(fakeCallableRequest<CreateVisitorInput>({ displayName: 'Vera Sub 2' }, { uid: captain }));
    await addTeamSessionSubstituteHandler(
      fakeCallableRequest<AddTeamSessionSubstituteInput>(
        { teamId, sessionId, ref: { kind: 'visitor', visitorId: visitor.visitor.id } },
        { uid: captain },
      ),
    );

    const result = await clearTeamSessionSubstituteHandler(
      fakeCallableRequest<ClearTeamSessionSubstituteInput>(
        { teamId, sessionId, ref: { kind: 'visitor', visitorId: visitor.visitor.id } },
        { uid: captain },
      ),
    );
    expect(result.team.sessionVisitors?.[sessionId] ?? []).toHaveLength(0);
    await assertTeamValid(teamId);
  });
});

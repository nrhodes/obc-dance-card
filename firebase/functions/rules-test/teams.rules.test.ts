import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  assertFails,
  assertSucceeds,
  clientAnon,
  clientAs,
  makeTestEnv,
  seedDoc,
  seedMember,
} from './harness.js';

let env: RulesTestEnvironment;

const teamDoc = (over: Record<string, unknown> = {}) => ({
  id: 'team1',
  year: 2027,
  seriesId: 'ser1',
  name: 'Alice team',
  captainMemberId: 'alice',
  members: [{ ref: { kind: 'member', memberId: 'alice', displayName: 'Alice A' }, joinedAt: 'now' }],
  status: 'forming',
  createdAt: 'now',
  updatedAt: 'now',
  ...over,
});

beforeAll(async () => {
  env = await makeTestEnv();
});
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seedMember(env, 'alice', { active: true, role: 'member' });
  await seedMember(env, 'bob', { active: true, role: 'member' });
  await seedMember(env, 'inactive1', { active: false, role: 'member' });
  await seedMember(env, 'admin1', { active: true, role: 'admin' });
  await seedDoc(env, 'teams/team1', teamDoc());
});

describe('teams collection rules', () => {
  it('unauthenticated: cannot read', async () => {
    await assertFails(getDoc(doc(clientAnon(env), 'teams/team1')));
  });

  it('inactive member: cannot read', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'inactive1'), 'teams/team1')));
  });

  it('active member (captain): can read', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'alice'), 'teams/team1')));
  });

  it('active member (not on the team): can still read — roster parity', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'bob'), 'teams/team1')));
  });

  it('admin: can read', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'admin1'), 'teams/team1')));
  });

  it('nobody may write teams from the client, not even the captain', async () => {
    await assertFails(updateDoc(doc(clientAs(env, 'alice'), 'teams/team1'), { status: 'active' }));
    await assertFails(setDoc(doc(clientAs(env, 'admin1'), 'teams/team2'), teamDoc({ id: 'team2' })));
  });
});

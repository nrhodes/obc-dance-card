import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
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
  cohort: 'club',
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

// App-Store-review cohort partition (plan §8.1, decided 2026-09-05).
describe('teams collection rules — cohort partition', () => {
  beforeEach(async () => {
    await seedMember(env, 'reviewer1', { active: true, role: 'member', cohort: 'review' });
    await seedDoc(
      env,
      'teams/team2',
      teamDoc({
        id: 'team2',
        captainMemberId: 'reviewer1',
        cohort: 'review',
        members: [{ ref: { kind: 'member', memberId: 'reviewer1', displayName: 'Reviewer One' }, joinedAt: 'now' }],
      }),
    );
  });

  it('club member: cannot get() a review team', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'alice'), 'teams/team2')));
  });

  it('review member: cannot get() a club team', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'reviewer1'), 'teams/team1')));
  });

  it("club member: an unfiltered teams query fails (can't prove cohort scoping)", async () => {
    await assertFails(getDocs(collection(clientAs(env, 'alice'), 'teams')));
  });

  it('club member: a cohort-filtered teams query succeeds and excludes the review team', async () => {
    const snap = await assertSucceeds(
      getDocs(query(collection(clientAs(env, 'alice'), 'teams'), where('cohort', '==', 'club'))),
    );
    expect(snap.docs.map((d) => d.id)).toEqual(['team1']);
  });

  it('admin: an unfiltered teams query succeeds and returns both cohorts', async () => {
    const snap = await assertSucceeds(getDocs(collection(clientAs(env, 'admin1'), 'teams')));
    expect(snap.docs.map((d) => d.id).sort()).toEqual(['team1', 'team2']);
  });
});

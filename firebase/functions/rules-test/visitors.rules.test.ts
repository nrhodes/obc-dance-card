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

const visitorDoc = (over: Record<string, unknown> = {}) => ({
  id: 'vis1',
  displayName: 'Jane Visitor',
  createdByMemberId: 'alice',
  courtesyEmails: false,
  lastUsedAt: 'now',
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
  await seedDoc(env, 'visitors/vis1', visitorDoc());
});

describe('visitors collection rules', () => {
  it('unauthenticated: cannot read', async () => {
    await assertFails(getDoc(doc(clientAnon(env), 'visitors/vis1')));
  });

  it('inactive member: cannot read, even their own visitor', async () => {
    await seedDoc(env, 'visitors/vis2', visitorDoc({ id: 'vis2', createdByMemberId: 'inactive1' }));
    await assertFails(getDoc(doc(clientAs(env, 'inactive1'), 'visitors/vis2')));
  });

  it('active member (sponsor): can read their own visitor', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'alice'), 'visitors/vis1')));
  });

  it('active member (other, not sponsor): cannot read someone else\'s visitor', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'bob'), 'visitors/vis1')));
  });

  it('admin: can read any visitor', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'admin1'), 'visitors/vis1')));
  });

  it('nobody may write visitors from the client, even the sponsor', async () => {
    await assertFails(updateDoc(doc(clientAs(env, 'alice'), 'visitors/vis1'), { displayName: 'New Name' }));
    await assertFails(setDoc(doc(clientAs(env, 'admin1'), 'visitors/vis3'), visitorDoc({ id: 'vis3' })));
  });
});

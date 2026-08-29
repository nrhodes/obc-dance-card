import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
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

const inviteDoc = (over: Record<string, unknown> = {}) => ({
  id: 'inv1',
  scope: 'session',
  sessionIds: ['s1'],
  seriesId: null,
  teamId: null,
  fromMemberId: 'alice',
  toMemberId: 'bob',
  status: 'pending',
  createdBy: 'alice',
  expiresAt: 'later',
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
  await seedMember(env, 'carol', { active: true, role: 'member' });
  await seedMember(env, 'inactive1', { active: false, role: 'member' });
  await seedMember(env, 'admin1', { active: true, role: 'admin' });
  await seedDoc(env, 'invites/inv1', inviteDoc());
});

describe('invites collection rules', () => {
  it('unauthenticated: cannot read', async () => {
    await assertFails(getDoc(doc(clientAnon(env), 'invites/inv1')));
  });

  it('inactive member: cannot read even if named on the invite', async () => {
    await seedDoc(env, 'invites/inv2', inviteDoc({ id: 'inv2', toMemberId: 'inactive1' }));
    await assertFails(getDoc(doc(clientAs(env, 'inactive1'), 'invites/inv2')));
  });

  it('active member (participant, sender): can read', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'alice'), 'invites/inv1')));
  });

  it('active member (participant, recipient): can read', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'bob'), 'invites/inv1')));
  });

  it('active member (other, not a participant): cannot read', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'carol'), 'invites/inv1')));
  });

  it('admin: can read any invite', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'admin1'), 'invites/inv1')));
  });

  it('nobody may write invites from the client, participants included', async () => {
    await assertFails(updateDoc(doc(clientAs(env, 'bob'), 'invites/inv1'), { status: 'accepted' }));
    await assertFails(updateDoc(doc(clientAs(env, 'alice'), 'invites/inv1'), { status: 'cancelled' }));
    await assertFails(setDoc(doc(clientAs(env, 'admin1'), 'invites/inv3'), inviteDoc({ id: 'inv3' })));
  });

  it('the inbox and outbox QUERIES (not just single-doc reads) are allowed for the participant', async () => {
    await seedDoc(env, 'invites/q1', {
      id: 'q1', scope: 'session', year: 2027, sessionIds: ['s1'], seriesId: null, teamId: null,
      fromMemberId: 'alice', toMemberId: 'bob', status: 'pending', expiresAt: '2099-01-01T00:00:00.000Z',
      createdBy: 'alice', createdAt: '2026-08-29T00:00:00.000Z', updatedAt: '2026-08-29T00:00:00.000Z',
    });
    const bob = clientAs(env, 'bob');
    const inbox = query(collection(bob, 'invites'), where('toMemberId', '==', 'bob'), where('status', '==', 'pending'), orderBy('createdAt', 'desc'));
    await assertSucceeds(getDocs(inbox));
    const alice = clientAs(env, 'alice');
    const outbox = query(collection(alice, 'invites'), where('fromMemberId', '==', 'alice'), where('status', '==', 'pending'), orderBy('createdAt', 'desc'));
    await assertSucceeds(getDocs(outbox));
    const resolved = query(collection(bob, 'invites'), where('toMemberId', '==', 'bob'), where('status', 'in', ['accepted', 'declined']), orderBy('createdAt', 'desc'));
    await assertSucceeds(getDocs(resolved));
  });

  it('a non-participant cannot query the invites collection', async () => {
    const carol = clientAs(env, 'carol');
    await assertFails(getDocs(query(collection(carol, 'invites'), where('status', '==', 'pending'))));
  });
});

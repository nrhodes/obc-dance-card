import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
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

const notificationDoc = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  memberId: 'alice',
  type: 'invite_received',
  title: 'You have an invite',
  body: 'Bob invited you to play Monday.',
  data: {},
  channelsSent: ['inapp'],
  read: false,
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
  await seedDoc(env, 'notifications/n1', notificationDoc());
});

describe('notifications collection rules', () => {
  it('unauthenticated: cannot read', async () => {
    await assertFails(getDoc(doc(clientAnon(env), 'notifications/n1')));
  });

  it('inactive member: cannot read even their own notification', async () => {
    await seedDoc(env, 'notifications/n2', notificationDoc({ id: 'n2', memberId: 'inactive1' }));
    await assertFails(getDoc(doc(clientAs(env, 'inactive1'), 'notifications/n2')));
  });

  it('active member (owner): can read their own notification', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'alice'), 'notifications/n1')));
  });

  it('active member (other): cannot read someone else\'s notification', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'bob'), 'notifications/n1')));
  });

  it('admin: cannot read another member\'s notification either — no admin carve-out in §10', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'admin1'), 'notifications/n1')));
  });

  it('owner may set read=true and readAt', async () => {
    await assertSucceeds(
      updateDoc(doc(clientAs(env, 'alice'), 'notifications/n1'), { read: true, readAt: 'now2' }),
    );
  });

  it('owner may set read=true alone', async () => {
    await assertSucceeds(updateDoc(doc(clientAs(env, 'alice'), 'notifications/n1'), { read: true }));
  });

  it('owner may not change any other field, even alongside read', async () => {
    await assertFails(updateDoc(doc(clientAs(env, 'alice'), 'notifications/n1'), { read: true, title: 'hacked' }));
    await assertFails(updateDoc(doc(clientAs(env, 'alice'), 'notifications/n1'), { body: 'hacked' }));
  });

  it('owner may not set read to a non-boolean', async () => {
    await assertFails(updateDoc(doc(clientAs(env, 'alice'), 'notifications/n1'), { read: 'yes' }));
  });

  it('another member may not update the owner\'s notification', async () => {
    await assertFails(updateDoc(doc(clientAs(env, 'bob'), 'notifications/n1'), { read: true }));
  });

  it('nobody may create or delete a notification from the client', async () => {
    await assertFails(setDoc(doc(clientAs(env, 'alice'), 'notifications/n3'), notificationDoc({ id: 'n3' })));
    await assertFails(deleteDoc(doc(clientAs(env, 'alice'), 'notifications/n1')));
  });
});

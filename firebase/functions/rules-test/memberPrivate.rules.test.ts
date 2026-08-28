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

const privateDoc = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  emailLower: `${id}@example.org`,
  notificationPrefs: {
    push: true,
    email: true,
    reminders: true,
    matchmakingAlerts: false,
    digest: 'immediate',
    reminderDaysBefore: 2,
  },
  devices: [],
  hasPassword: false,
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
  await seedDoc(env, 'memberPrivate/alice', privateDoc('alice'));
});

describe('memberPrivate collection rules', () => {
  it('unauthenticated: cannot read', async () => {
    await assertFails(getDoc(doc(clientAnon(env), 'memberPrivate/alice')));
  });

  it('inactive member: cannot read even their own doc', async () => {
    await seedDoc(env, 'memberPrivate/inactive1', privateDoc('inactive1'));
    await assertFails(getDoc(doc(clientAs(env, 'inactive1'), 'memberPrivate/inactive1')));
  });

  it('active member (self): can read their own private doc', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'alice'), 'memberPrivate/alice')));
  });

  it('active member (other): cannot read someone else\'s private doc', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'bob'), 'memberPrivate/alice')));
  });

  it('admin: can read any member\'s private doc', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'admin1'), 'memberPrivate/alice')));
  });

  it('nobody may write memberPrivate from the client, even their own', async () => {
    await assertFails(updateDoc(doc(clientAs(env, 'alice'), 'memberPrivate/alice'), { hasPassword: true }));
    await assertFails(setDoc(doc(clientAs(env, 'admin1'), 'memberPrivate/bob'), privateDoc('bob')));
  });
});

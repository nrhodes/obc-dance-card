import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { assertFails, assertSucceeds, clientAnon, clientAs, makeTestEnv, seedMember } from './harness.js';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await makeTestEnv();
});
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seedMember(env, 'alice', { firstName: 'Alice', active: true, role: 'member' });
});

describe('members collection rules', () => {
  it('unauthenticated: cannot read', async () => {
    await assertFails(getDoc(doc(clientAnon(env), 'members/alice')));
  });

  it('inactive member: cannot read', async () => {
    await seedMember(env, 'bob', { active: false });
    await assertFails(getDoc(doc(clientAs(env, 'bob'), 'members/alice')));
  });

  it('active member (self): can read their own doc', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'alice'), 'members/alice')));
  });

  it('active member (other): can read another active member (roster parity)', async () => {
    await seedMember(env, 'bob', { active: true });
    await assertSucceeds(getDoc(doc(clientAs(env, 'bob'), 'members/alice')));
  });

  it('active member: cannot read a deactivated member other than themselves', async () => {
    await seedMember(env, 'bob', { active: true });
    await seedMember(env, 'carol', { active: false });
    await assertFails(getDoc(doc(clientAs(env, 'bob'), 'members/carol')));
  });

  it('admin: can read any member, active or not', async () => {
    await seedMember(env, 'admin1', { role: 'admin', active: true });
    await seedMember(env, 'carol', { active: false });
    await assertSucceeds(getDoc(doc(clientAs(env, 'admin1'), 'members/carol')));
  });

  it('no client — member, or admin — may create, update, or delete a member doc', async () => {
    await seedMember(env, 'admin1', { role: 'admin', active: true });
    await assertFails(setDoc(doc(clientAs(env, 'admin1'), 'members/dave'), { id: 'dave', active: true }));
    await assertFails(updateDoc(doc(clientAs(env, 'alice'), 'members/alice'), { phone: '021 999 9999' }));
    await assertFails(updateDoc(doc(clientAs(env, 'admin1'), 'members/alice'), { role: 'admin' }));
    await assertFails(deleteDoc(doc(clientAs(env, 'admin1'), 'members/alice')));
  });
});

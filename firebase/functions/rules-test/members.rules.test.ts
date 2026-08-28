import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { setDoc, doc, getDoc, updateDoc } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { asAdmin, asInactive, asMember, assertFails, assertSucceeds, makeTestEnv } from './harness.js';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await makeTestEnv();
});
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'members/alice'), {
      id: 'alice',
      firstName: 'Alice',
      lastName: 'A',
      emailLower: 'alice@example.org',
      phone: '021 000 0001',
      grade: 'Open',
      role: 'member',
      active: true,
    });
    await setDoc(doc(db, 'members/bob'), {
      id: 'bob',
      firstName: 'Bob',
      lastName: 'B',
      emailLower: 'bob@example.org',
      phone: '021 000 0002',
      grade: 'Junior',
      role: 'member',
      active: true,
    });
  });
});

describe('members collection rules', () => {
  it('an active member can read any member (roster visibility)', async () => {
    const db = env.authenticatedContext('bob', asMember).firestore();
    await assertSucceeds(getDoc(doc(db, 'members/alice')));
  });

  it('an inactive member cannot read members', async () => {
    const db = env.authenticatedContext('bob', asInactive).firestore();
    await assertFails(getDoc(doc(db, 'members/alice')));
  });

  it('a signed-out user cannot read members', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'members/alice')));
  });

  it('a member may update only their own phone / prefs / devices', async () => {
    const db = env.authenticatedContext('alice', asMember).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'members/alice'), { phone: '021 999 9999', updatedAt: 'now' }),
    );
    await assertFails(updateDoc(doc(db, 'members/alice'), { role: 'admin' }));
    await assertFails(updateDoc(doc(db, 'members/alice'), { active: false }));
  });

  it('a member cannot update another member', async () => {
    const db = env.authenticatedContext('alice', asMember).firestore();
    await assertFails(updateDoc(doc(db, 'members/bob'), { phone: '021 111 1111' }));
  });

  it('an admin may update any member', async () => {
    const db = env.authenticatedContext('carol', asAdmin).firestore();
    await assertSucceeds(updateDoc(doc(db, 'members/bob'), { grade: 'Intermediate' }));
  });

  it('nobody may create or delete members from the client', async () => {
    const db = env.authenticatedContext('carol', asAdmin).firestore();
    await assertFails(setDoc(doc(db, 'members/dave'), { id: 'dave', active: true }));
  });
});

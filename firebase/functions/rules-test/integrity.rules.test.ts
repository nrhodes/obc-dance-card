import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { assertFails, clientAs, makeTestEnv, seedDoc, seedMember } from './harness.js';

let env: RulesTestEnvironment;

const runDoc = () => ({
  id: 'run1',
  at: 'now',
  repair: false,
  checkedSessions: 0,
  checkedTeams: 0,
  violations: [],
  repaired: 0,
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
  await seedMember(env, 'admin1', { active: true, role: 'admin' });
  await seedDoc(env, 'integrity/run1', runDoc());
});

describe('integrity collection rules — server-only (plan §16 Phase 6)', () => {
  it('active member: cannot read a sweep run', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'alice'), 'integrity/run1')));
  });

  it('admin: cannot read a sweep run either — `listAuditLog`-style callables are the only path, and there is none for this collection', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'admin1'), 'integrity/run1')));
  });

  it('nobody may write, even an admin', async () => {
    await assertFails(setDoc(doc(clientAs(env, 'admin1'), 'integrity/run2'), runDoc()));
    await assertFails(setDoc(doc(clientAs(env, 'alice'), 'integrity/run3'), runDoc()));
  });
});

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

beforeAll(async () => {
  env = await makeTestEnv();
});
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seedMember(env, 'alice', { active: true, role: 'member' });
  await seedMember(env, 'inactive1', { active: false, role: 'member' });
  await seedMember(env, 'admin1', { active: true, role: 'admin' });
});

describe('programmes/{year} — draft', () => {
  beforeEach(async () => {
    await seedDoc(env, 'programmes/2027', { id: '2027', year: 2027, status: 'draft', createdAt: 'now', updatedAt: 'now' });
    await seedDoc(env, 'programmes/2027/series/ser1', {
      id: 'ser1',
      weekday: 'monday',
      name: 'Marion Taylor Pairs',
      createdAt: 'now',
      updatedAt: 'now',
    });
    await seedDoc(env, 'programmes/2027/sessions/sess1', {
      id: 'sess1',
      date: '2027-01-11',
      weekday: 'monday',
      seriesId: 'ser1',
      kind: 'series',
      title: 'Marion Taylor Pairs',
      partnerRequired: true,
      createdAt: 'now',
      updatedAt: 'now',
    });
  });

  it('unauthenticated: cannot read the draft programme', async () => {
    await assertFails(getDoc(doc(clientAnon(env), 'programmes/2027')));
  });

  it('inactive member: cannot read the draft programme', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'inactive1'), 'programmes/2027')));
  });

  it('active member: cannot read a draft programme', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'alice'), 'programmes/2027')));
  });

  it('active member: cannot read a draft programme\'s sub-collections either', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'alice'), 'programmes/2027/series/ser1')));
  });

  it('active member: cannot read a draft programme\'s sessions', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'alice'), 'programmes/2027/sessions/sess1')));
  });

  it('admin: can read a draft programme and its sub-collections', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'admin1'), 'programmes/2027')));
    await assertSucceeds(getDoc(doc(clientAs(env, 'admin1'), 'programmes/2027/series/ser1')));
    await assertSucceeds(getDoc(doc(clientAs(env, 'admin1'), 'programmes/2027/sessions/sess1')));
  });
});

describe('programmes/{year} — published', () => {
  beforeEach(async () => {
    await seedDoc(env, 'programmes/2027', {
      id: '2027',
      year: 2027,
      status: 'published',
      createdAt: 'now',
      updatedAt: 'now',
    });
    await seedDoc(env, 'programmes/2027/series/ser1', {
      id: 'ser1',
      weekday: 'monday',
      name: 'Marion Taylor Pairs',
      createdAt: 'now',
      updatedAt: 'now',
    });
    await seedDoc(env, 'programmes/2027/sessions/sess1', {
      id: 'sess1',
      date: '2027-01-11',
      weekday: 'monday',
      seriesId: 'ser1',
      kind: 'series',
      title: 'Marion Taylor Pairs',
      partnerRequired: true,
      createdAt: 'now',
      updatedAt: 'now',
    });
  });

  it('unauthenticated: still cannot read', async () => {
    await assertFails(getDoc(doc(clientAnon(env), 'programmes/2027')));
  });

  it('inactive member: still cannot read', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'inactive1'), 'programmes/2027')));
  });

  it('active member: can read a published programme and its sub-collections', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'alice'), 'programmes/2027')));
    await assertSucceeds(getDoc(doc(clientAs(env, 'alice'), 'programmes/2027/series/ser1')));
  });

  it('active member: can read the sessions of a published year', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'alice'), 'programmes/2027/sessions/sess1')));
  });

  it('admin: can read', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'admin1'), 'programmes/2027')));
  });

  it('nobody may write a programme or its sub-collections from the client', async () => {
    await assertFails(updateDoc(doc(clientAs(env, 'admin1'), 'programmes/2027'), { status: 'draft' }));
    await assertFails(
      updateDoc(doc(clientAs(env, 'admin1'), 'programmes/2027/series/ser1'), { name: 'Renamed' }),
    );
    await assertFails(setDoc(doc(clientAs(env, 'admin1'), 'programmes/2028'), { id: '2028', year: 2028, status: 'draft' }));
  });
});

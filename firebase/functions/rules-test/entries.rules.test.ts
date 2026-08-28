import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { deleteDoc, doc, getDoc, getDocs, collection, setDoc, updateDoc } from 'firebase/firestore';
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

const soloEntry = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  sessionId: 's1',
  date: '2027-01-11',
  weekday: 'monday',
  seriesId: 'ser1',
  memberId: 'alice',
  status: 'looking_for_partner',
  partner: null,
  pairingId: null,
  teamId: null,
  teamSessionOnly: false,
  substitute: null,
  partnerSubstitute: null,
  isSubstituteFor: null,
  createdBy: 'alice',
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
});

describe('entries collection rules — read', () => {
  beforeEach(async () => {
    await seedDoc(env, 'entries/e1', soloEntry());
  });

  it('unauthenticated: cannot read', async () => {
    await assertFails(getDoc(doc(clientAnon(env), 'entries/e1')));
  });

  it('inactive member: cannot read', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'inactive1'), 'entries/e1')));
  });

  it('active member (self): can read', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'alice'), 'entries/e1')));
  });

  it('active member (other): can read — roster visibility', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'bob'), 'entries/e1')));
  });

  it('admin: can read', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'admin1'), 'entries/e1')));
  });

  it('active member: can list the collection (roster query)', async () => {
    await assertSucceeds(getDocs(collection(clientAs(env, 'bob'), 'entries')));
  });
});

describe('entries collection rules — every client write is denied', () => {
  it('a member may not create any entry, solo or otherwise', async () => {
    await assertFails(setDoc(doc(clientAs(env, 'alice'), 'entries/e1'), soloEntry()));
  });

  it('an admin may not create an entry either — pairing/team invariants require a callable', async () => {
    await assertFails(setDoc(doc(clientAs(env, 'admin1'), 'entries/e1'), soloEntry()));
  });

  it('a member may not update their own existing entry', async () => {
    await seedDoc(env, 'entries/e1', soloEntry());
    await assertFails(
      updateDoc(doc(clientAs(env, 'alice'), 'entries/e1'), { status: 'cancelled', updatedAt: 'now2' }),
    );
  });

  it('an admin may not update an entry from the client', async () => {
    await seedDoc(env, 'entries/e1', soloEntry());
    await assertFails(updateDoc(doc(clientAs(env, 'admin1'), 'entries/e1'), { status: 'cancelled' }));
  });

  it('a member may not delete their own entry', async () => {
    await seedDoc(env, 'entries/e1', soloEntry());
    await assertFails(deleteDoc(doc(clientAs(env, 'alice'), 'entries/e1')));
  });

  it('an admin may not delete an entry from the client', async () => {
    await seedDoc(env, 'entries/e1', soloEntry());
    await assertFails(deleteDoc(doc(clientAs(env, 'admin1'), 'entries/e1')));
  });
});

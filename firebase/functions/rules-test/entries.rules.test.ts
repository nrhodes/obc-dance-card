import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteDoc, doc, getDoc, getDocs, collection, query, setDoc, updateDoc, where } from 'firebase/firestore';
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
  cohort: 'club',
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

  it('active member (other, same cohort): can read — roster visibility', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'bob'), 'entries/e1')));
  });

  it('admin: can read', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'admin1'), 'entries/e1')));
  });

  // App-Store-review cohort partition (plan §8.1, decided 2026-09-05):
  // provability — an unfiltered roster query can no longer be proven safe
  // for a non-admin (it isn't scoped to the caller's own entries, and
  // carries no cohort filter), so Firestore must reject it outright, not
  // silently filter it. `where('cohort', '==', ownCohort)` is what makes it
  // provable again; a plain `memberId == uid` "my entries" query is provable
  // via the ownership disjunct with NO cohort filter at all.
  it("active member: an unfiltered roster query fails (can't prove cohort scoping)", async () => {
    await assertFails(getDocs(collection(clientAs(env, 'bob'), 'entries')));
  });

  it('active member: a cohort-filtered roster query succeeds', async () => {
    await assertSucceeds(
      getDocs(query(collection(clientAs(env, 'bob'), 'entries'), where('cohort', '==', 'club'))),
    );
  });

  it('active member: a memberId==uid "my entries" query succeeds with NO cohort filter', async () => {
    const snap = await assertSucceeds(
      getDocs(query(collection(clientAs(env, 'alice'), 'entries'), where('memberId', '==', 'alice'))),
    );
    expect(snap.docs.map((d) => d.id)).toEqual(['e1']);
  });

  it('admin: an unfiltered roster query succeeds', async () => {
    await assertSucceeds(getDocs(collection(clientAs(env, 'admin1'), 'entries')));
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

// App-Store-review cohort partition (plan §8.1, decided 2026-09-05).
describe('entries collection rules — cohort partition', () => {
  beforeEach(async () => {
    await seedMember(env, 'reviewer1', { active: true, role: 'member', cohort: 'review' });
    await seedDoc(env, 'entries/e1', soloEntry({ cohort: 'club' }));
    await seedDoc(
      env,
      'entries/e2',
      soloEntry({ id: 'e2', sessionId: 's2', memberId: 'reviewer1', cohort: 'review', createdBy: 'reviewer1' }),
    );
  });

  it('club member: cannot get() a review entry', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'alice'), 'entries/e2')));
  });

  it('review member: cannot get() a club entry belonging to someone else', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'reviewer1'), 'entries/e1')));
  });

  it('review member: can always read their OWN entry, even without a cohort filter', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'reviewer1'), 'entries/e2')));
  });

  it('club member: a cohort-filtered roster query never returns the review entry', async () => {
    const snap = await assertSucceeds(
      getDocs(query(collection(clientAs(env, 'alice'), 'entries'), where('cohort', '==', 'club'))),
    );
    expect(snap.docs.map((d) => d.id)).toEqual(['e1']);
  });

  it('admin: can get() a review entry', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'admin1'), 'entries/e2')));
  });
});

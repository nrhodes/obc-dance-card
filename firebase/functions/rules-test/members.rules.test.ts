import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
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

// App-Store-review cohort partition (plan §8.1, decided 2026-09-05).
describe('members collection rules — cohort partition', () => {
  beforeEach(async () => {
    await seedMember(env, 'reviewer1', { firstName: 'Reviewer', active: true, cohort: 'review' });
  });

  it('club member: cannot get() a review member', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'alice'), 'members/reviewer1')));
  });

  it('review member: cannot get() a club member', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'reviewer1'), 'members/alice')));
  });

  it('review member: can get() another review member', async () => {
    await seedMember(env, 'reviewer2', { firstName: 'Reviewer Two', active: true, cohort: 'review' });
    await assertSucceeds(getDoc(doc(clientAs(env, 'reviewer1'), 'members/reviewer2')));
  });

  it('admin: can get() a review member', async () => {
    await seedMember(env, 'admin1', { role: 'admin', active: true });
    await assertSucceeds(getDoc(doc(clientAs(env, 'admin1'), 'members/reviewer1')));
  });

  it("club member: an unfiltered active-members query fails (can't prove every result is club-cohort)", async () => {
    await assertFails(getDocs(query(collection(clientAs(env, 'alice'), 'members'), where('active', '==', true))));
  });

  it('club member: an active+cohort-filtered query succeeds and returns only club members', async () => {
    const snap = await assertSucceeds(
      getDocs(
        query(collection(clientAs(env, 'alice'), 'members'), where('active', '==', true), where('cohort', '==', 'club')),
      ),
    );
    const ids = snap.docs.map((d) => d.id);
    expect(ids).toContain('alice');
    expect(ids).not.toContain('reviewer1');
  });

  it('review member: an active+cohort-filtered query returns only review members', async () => {
    const snap = await assertSucceeds(
      getDocs(
        query(
          collection(clientAs(env, 'reviewer1'), 'members'),
          where('active', '==', true),
          where('cohort', '==', 'review'),
        ),
      ),
    );
    const ids = snap.docs.map((d) => d.id);
    expect(ids).toContain('reviewer1');
    expect(ids).not.toContain('alice');
  });

  it('admin: an unfiltered members query succeeds and returns both cohorts', async () => {
    await seedMember(env, 'admin1', { role: 'admin', active: true });
    const snap = await assertSucceeds(getDocs(collection(clientAs(env, 'admin1'), 'members')));
    const ids = snap.docs.map((d) => d.id);
    expect(ids).toContain('alice');
    expect(ids).toContain('reviewer1');
  });
});

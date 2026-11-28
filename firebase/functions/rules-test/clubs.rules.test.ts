/**
 * Club isolation (plan §21 B14.4): membership of one club grants nothing in
 * another, an admin of one club is not an admin of another, and the
 * pre-migration top-level collections are denied to everyone.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { assertFails, assertSucceeds, clientAnon, clientAs, makeTestEnv, seedDoc, seedMember } from './harness.js';

let env: RulesTestEnvironment;

const entry = (memberId: string) => ({
  id: `s1_${memberId}`,
  sessionId: 's1',
  date: '2027-03-01',
  memberId,
  cohort: 'club',
  status: 'available',
});

beforeAll(async () => {
  env = await makeTestEnv();
});
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  // orewa: alice (member), oadmin (admin). other: bob (member), badmin (admin).
  // carol belongs to both.
  await seedMember(env, 'alice');
  await seedMember(env, 'oadmin', { role: 'admin' });
  await seedMember(env, 'carol');
  await seedMember(env, 'bob', { clubId: 'other' });
  await seedMember(env, 'badmin', { clubId: 'other', role: 'admin' });
  await seedMember(env, 'carol', { clubId: 'other' });
  for (const club of ['orewa', 'other']) {
    await seedDoc(env, `clubs/${club}`, { id: club, name: club, status: 'active' });
    await seedDoc(env, `clubs/${club}/programmes/2027`, { year: 2027, status: 'published' });
    await seedDoc(env, `clubs/${club}/programmes/2027/sessions/s1`, { id: 's1', date: '2027-03-01' });
    await seedDoc(env, `clubs/${club}/teams/t1`, { id: 't1', cohort: 'club' });
    await seedDoc(env, `clubs/${club}/auditLog/a1`, { id: 'a1' });
  }
  await seedDoc(env, 'clubs/orewa/entries/s1_alice', entry('alice'));
  await seedDoc(env, 'clubs/other/entries/s1_bob', entry('bob'));
  await seedDoc(env, 'clubs/other/visitors/v1', { id: 'v1', createdByMemberId: 'bob' });
  await seedDoc(env, 'clubs/other/invites/i1', { id: 'i1', fromMemberId: 'bob', toMemberId: 'carol' });
});

describe('club isolation', () => {
  it('a member reads their own club: the club record, members, programme, entries, teams', async () => {
    const db = clientAs(env, 'alice');
    await assertSucceeds(getDoc(doc(db, 'clubs/orewa')));
    await assertSucceeds(getDoc(doc(db, 'clubs/orewa/members/oadmin')));
    await assertSucceeds(getDoc(doc(db, 'clubs/orewa/programmes/2027/sessions/s1')));
    await assertSucceeds(getDoc(doc(db, 'clubs/orewa/entries/s1_alice')));
    await assertSucceeds(getDoc(doc(db, 'clubs/orewa/teams/t1')));
    await assertSucceeds(
      getDocs(query(collection(db, 'clubs/orewa/members'), where('cohort', '==', 'club'), where('active', '==', true))),
    );
  });

  it('a member of one club reads nothing of another', async () => {
    const db = clientAs(env, 'alice');
    await assertFails(getDoc(doc(db, 'clubs/other')));
    await assertFails(getDoc(doc(db, 'clubs/other/members/bob')));
    await assertFails(getDoc(doc(db, 'clubs/other/programmes/2027')));
    await assertFails(getDoc(doc(db, 'clubs/other/programmes/2027/sessions/s1')));
    await assertFails(getDoc(doc(db, 'clubs/other/entries/s1_bob')));
    await assertFails(getDoc(doc(db, 'clubs/other/teams/t1')));
    await assertFails(getDoc(doc(db, 'clubs/other/visitors/v1')));
    await assertFails(getDoc(doc(db, 'clubs/other/invites/i1')));
    await assertFails(
      getDocs(query(collection(db, 'clubs/other/members'), where('cohort', '==', 'club'), where('active', '==', true))),
    );
    await assertFails(getDocs(query(collection(db, 'clubs/other/entries'), where('cohort', '==', 'club'))));
  });

  it("an admin of one club is not an admin of another, and cannot read it", async () => {
    const db = clientAs(env, 'oadmin');
    await assertSucceeds(getDocs(collection(db, 'clubs/orewa/members')));
    await assertFails(getDocs(collection(db, 'clubs/other/members')));
    await assertFails(getDoc(doc(db, 'clubs/other/entries/s1_bob')));
    await assertFails(getDoc(doc(db, 'clubs/other/visitors/v1')));
  });

  it('a person in both clubs reads both', async () => {
    const db = clientAs(env, 'carol');
    await assertSucceeds(getDoc(doc(db, 'clubs/orewa/entries/s1_alice')));
    await assertSucceeds(getDoc(doc(db, 'clubs/other/entries/s1_bob')));
    await assertSucceeds(getDoc(doc(db, 'clubs/other/invites/i1')));
  });

  it('a deactivated membership in one club closes that club only', async () => {
    await seedMember(env, 'carol', { clubId: 'other', active: false });
    const db = clientAs(env, 'carol');
    await assertSucceeds(getDoc(doc(db, 'clubs/orewa/entries/s1_alice')));
    await assertFails(getDoc(doc(db, 'clubs/other/entries/s1_bob')));
  });

  it("no client reads a club's audit log, not even its admin", async () => {
    await assertFails(getDoc(doc(clientAs(env, 'oadmin'), 'clubs/orewa/auditLog/a1')));
  });

  it('no client writes anything under a club', async () => {
    const db = clientAs(env, 'oadmin');
    await assertFails(setDoc(doc(db, 'clubs/orewa'), { name: 'renamed' }));
    await assertFails(setDoc(doc(db, 'clubs/orewa/members/oadmin'), { role: 'admin' }));
    await assertFails(setDoc(doc(db, 'clubs/orewa/entries/x'), entry('oadmin')));
    await assertFails(setDoc(doc(db, 'clubs/newclub'), { name: 'mine' }));
  });

  it('unauthenticated: nothing', async () => {
    const db = clientAnon(env);
    await assertFails(getDoc(doc(db, 'clubs/orewa')));
    await assertFails(getDoc(doc(db, 'clubs/orewa/members/alice')));
  });
});

describe('users/{uid}', () => {
  it('readable by the person alone, never writable', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'alice'), 'users/alice')));
    await assertFails(getDoc(doc(clientAs(env, 'oadmin'), 'users/alice')));
    await assertFails(getDoc(doc(clientAnon(env), 'users/alice')));
    await assertFails(setDoc(doc(clientAs(env, 'alice'), 'users/alice'), { clubIds: ['orewa', 'other'] }));
  });
});

describe('pre-migration top-level collections', () => {
  it('are denied to everyone, including an admin', async () => {
    for (const path of [
      'members/alice',
      'memberPrivate/alice',
      'entries/s1_alice',
      'teams/t1',
      'invites/i1',
      'visitors/v1',
      'programmes/2027',
      'programmes/2027/sessions/s1',
      'auditLog/a1',
      'imports/x',
      'integrity/x',
    ]) {
      await seedDoc(env, path, { id: 'legacy', memberId: 'alice', cohort: 'club', status: 'published' });
      await assertFails(getDoc(doc(clientAs(env, 'alice'), path)));
      await assertFails(getDoc(doc(clientAs(env, 'oadmin'), path)));
    }
  });
});

describe('platformAdmins and platformAuditLog (plan §21 B14.3)', () => {
  beforeEach(async () => {
    await seedDoc(env, 'platformAdmins/oadmin', { id: 'oadmin', grantedAt: 'now', grantedBy: 'test' });
    await seedDoc(env, 'platformAuditLog/p1', { id: 'p1', action: 'club_created' });
  });

  it('a person can see whether they are a platform admin, and nobody else can', async () => {
    await assertSucceeds(getDoc(doc(clientAs(env, 'oadmin'), 'platformAdmins/oadmin')));
    // Not a platform admin: the read of their own (absent) doc is still allowed.
    await assertSucceeds(getDoc(doc(clientAs(env, 'alice'), 'platformAdmins/alice')));
    await assertFails(getDoc(doc(clientAs(env, 'alice'), 'platformAdmins/oadmin')));
    await assertFails(getDoc(doc(clientAnon(env), 'platformAdmins/oadmin')));
    await assertFails(getDocs(collection(clientAs(env, 'oadmin'), 'platformAdmins')));
  });

  it('nobody can grant it from a client — not even an existing platform admin', async () => {
    await assertFails(setDoc(doc(clientAs(env, 'alice'), 'platformAdmins/alice'), { id: 'alice' }));
    await assertFails(setDoc(doc(clientAs(env, 'oadmin'), 'platformAdmins/alice'), { id: 'alice' }));
  });

  it('a platform admin gains no read of a club they are not a member of', async () => {
    const db = clientAs(env, 'oadmin');
    await assertFails(getDoc(doc(db, 'clubs/other')));
    await assertFails(getDoc(doc(db, 'clubs/other/members/bob')));
    await assertFails(getDoc(doc(db, 'clubs/other/entries/s1_bob')));
  });

  it('the platform audit log is unreadable by every client', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'oadmin'), 'platformAuditLog/p1')));
  });
});

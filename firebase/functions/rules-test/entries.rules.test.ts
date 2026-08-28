import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { setDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { asMember, assertFails, assertSucceeds, makeTestEnv } from './harness.js';

let env: RulesTestEnvironment;

const soloEntry = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  sessionId: 's1',
  date: '2027-01-11',
  seriesId: 'ser1',
  memberId: 'alice',
  partnerMemberId: null,
  status: 'looking_for_partner',
  pairingId: null,
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
});

describe('entries collection rules', () => {
  it('a member may create their own solo looking_for_partner entry', async () => {
    const db = env.authenticatedContext('alice', asMember).firestore();
    await assertSucceeds(setDoc(doc(db, 'entries/e1'), soloEntry()));
  });

  it('a member may not create an entry for someone else', async () => {
    const db = env.authenticatedContext('alice', asMember).firestore();
    await assertFails(setDoc(doc(db, 'entries/e1'), soloEntry({ memberId: 'bob', createdBy: 'bob' })));
  });

  it('a member may not self-create a confirmed / paired entry', async () => {
    const db = env.authenticatedContext('alice', asMember).firestore();
    await assertFails(
      setDoc(doc(db, 'entries/e1'), soloEntry({ status: 'confirmed', partnerMemberId: 'bob', pairingId: 'p1' })),
    );
  });

  it('a member may cancel their own still-solo entry', async () => {
    const db = env.authenticatedContext('alice', asMember).firestore();
    await setDoc(doc(db, 'entries/e1'), soloEntry());
    await assertSucceeds(updateDoc(doc(db, 'entries/e1'), { status: 'cancelled', updatedAt: 'now2' }));
  });

  it('a member may not promote their entry to confirmed or attach a partner', async () => {
    const db = env.authenticatedContext('alice', asMember).firestore();
    await setDoc(doc(db, 'entries/e1'), soloEntry());
    await assertFails(updateDoc(doc(db, 'entries/e1'), { status: 'confirmed' }));
    await assertFails(updateDoc(doc(db, 'entries/e1'), { partnerMemberId: 'bob', pairingId: 'p1' }));
  });

  it('a member may not modify a paired entry at all', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'entries/e1'), soloEntry({
        status: 'confirmed',
        partnerMemberId: 'bob',
        pairingId: 'p1',
      }));
    });
    const db = env.authenticatedContext('alice', asMember).firestore();
    await assertFails(updateDoc(doc(db, 'entries/e1'), { status: 'cancelled' }));
    await assertFails(deleteDoc(doc(db, 'entries/e1')));
  });
});

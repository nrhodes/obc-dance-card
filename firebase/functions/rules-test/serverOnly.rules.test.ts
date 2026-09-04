/**
 * `auditLog`, `emailCodes`, `rateLimits`, `imports`, `icalTokens` (plan §5.10,
 * §21 B1): every server-only collection the rules deny to *every* client role
 * — unauthenticated, inactive member, active member (self/other), and admin.
 * Unlike `integrity.rules.test.ts` (which covers `integrity/{id}` alone),
 * this is the consolidated "server-only" suite the plan's B1 spec asks for,
 * grown to include the new `icalTokens` collection alongside the four
 * originals.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { assertFails, clientAnon, clientAs, makeTestEnv, seedDoc, seedMember } from './harness.js';

let env: RulesTestEnvironment;

interface ServerOnlyCollection {
  name: string;
  path: string;
  doc: Record<string, unknown>;
}

const COLLECTIONS: ServerOnlyCollection[] = [
  {
    name: 'auditLog',
    path: 'auditLog/entry1',
    doc: { id: 'entry1', at: 'now', actorMemberId: 'admin1', action: 'role_changed' },
  },
  {
    name: 'emailCodes',
    path: 'emailCodes/deadbeef',
    doc: { id: 'deadbeef', codeHmac: 'x', expiresAt: 'later', attempts: 0, createdAt: 'now' },
  },
  {
    name: 'rateLimits',
    path: 'rateLimits/bucket:hash',
    doc: { id: 'bucket:hash', windowStart: 'now', count: 1 },
  },
  {
    name: 'imports',
    path: 'imports/import1',
    doc: { id: 'import1', kind: 'members', actorMemberId: 'admin1', startedAt: 'now' },
  },
  {
    name: 'icalTokens',
    path: 'icalTokens/deadbeefhash',
    doc: { id: 'deadbeefhash', memberId: 'alice', createdAt: 'now' },
  },
];

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
  for (const c of COLLECTIONS) {
    await seedDoc(env, c.path, c.doc);
  }
});

describe.each(COLLECTIONS)('$name — server-only (plan §5.10 / §21 B1)', ({ path, doc: docData }) => {
  it('unauthenticated: cannot read', async () => {
    await assertFails(getDoc(doc(clientAnon(env), path)));
  });

  it('inactive member: cannot read', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'inactive1'), path)));
  });

  it('active member (self or other): cannot read', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'alice'), path)));
  });

  it('admin: cannot read either — no rules-level read path exists for this collection', async () => {
    await assertFails(getDoc(doc(clientAs(env, 'admin1'), path)));
  });

  it('nobody may write, not even an admin', async () => {
    await assertFails(setDoc(doc(clientAs(env, 'admin1'), path), docData));
    await assertFails(setDoc(doc(clientAs(env, 'alice'), path), docData));
    await assertFails(setDoc(doc(clientAnon(env), path), docData));
  });
});

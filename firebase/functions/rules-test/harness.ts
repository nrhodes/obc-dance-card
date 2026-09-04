import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, type Firestore } from 'firebase/firestore';

const rulesPath = fileURLToPath(new URL('../../firestore.rules', import.meta.url));

export { assertFails, assertSucceeds };

export async function makeTestEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: 'demo-obc',
    firestore: { rules: readFileSync(rulesPath, 'utf8') },
  });
}

export interface SeedMemberOptions {
  role?: 'member' | 'admin';
  active?: boolean;
  firstName?: string;
  lastName?: string;
  phone?: string;
  grade?: string;
  /** App-Store-review cohort partition (decided 2026-09-05). Defaults to `'club'`. */
  cohort?: 'club' | 'review';
}

/**
 * Seed a `members/{uid}` doc, bypassing rules. The rules now `get()` this doc
 * for every request (no custom claims are consulted), so **every** acting uid
 * used in a rules test — including admins — must have one, with the `active`
 * / `role` fields the test wants to exercise.
 */
export async function seedMember(
  env: RulesTestEnvironment,
  uid: string,
  opts: SeedMemberOptions = {},
): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `members/${uid}`), {
      id: uid,
      firstName: opts.firstName ?? 'Test',
      lastName: opts.lastName ?? uid,
      phone: opts.phone ?? '',
      grade: opts.grade ?? 'Open',
      role: opts.role ?? 'member',
      cohort: opts.cohort ?? 'club',
      active: opts.active ?? true,
      createdAt: 'now',
      updatedAt: 'now',
    });
  });
}

/** Seed an arbitrary document, bypassing rules, for arranging test state. */
export async function seedDoc(
  env: RulesTestEnvironment,
  path: string,
  data: Record<string, unknown>,
): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

/**
 * A signed-in client `Firestore` handle for `uid`. No custom claims are
 * needed — the rules only ever look at the seeded `members/{uid}` doc — so
 * this is just a plain authenticated context.
 */
export function clientAs(env: RulesTestEnvironment, uid: string): Firestore {
  return env.authenticatedContext(uid).firestore();
}

/** An unauthenticated client `Firestore` handle. */
export function clientAnon(env: RulesTestEnvironment): Firestore {
  return env.unauthenticatedContext().firestore();
}

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

const rulesPath = fileURLToPath(new URL('../../firestore.rules', import.meta.url));

export { assertFails, assertSucceeds };

export async function makeTestEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: 'demo-obc',
    firestore: { rules: readFileSync(rulesPath, 'utf8') },
  });
}

/** Auth token shapes for the three caller kinds the rules distinguish. */
export const asAdmin = { role: 'admin', active: true };
export const asMember = { role: 'member', active: true };
export const asInactive = { role: 'member', active: false };

/**
 * Seed documents bypassing rules, for arranging test state.
 */
export async function seed(
  env: RulesTestEnvironment,
  writer: (db: FirebaseFirestore.Firestore) => Promise<void>,
): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    // The unit-testing SDK's context exposes a firestore() compatible enough for
    // set/update/get used here.
    await writer(ctx.firestore() as unknown as FirebaseFirestore.Firestore);
  });
}

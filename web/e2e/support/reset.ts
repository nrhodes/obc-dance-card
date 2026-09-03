/**
 * Emulator-only test helpers to wipe the auth-throttling state between sign-ins,
 * so the login-code rate limit (3 requests / email / 15 min, plus per-IP caps)
 * never makes the E2E suite flaky when specs reuse the seeded accounts or a run
 * is repeated. Uses the Firestore emulator's `Authorization: Bearer owner`
 * bypass (valid only against the emulator).
 */
const FIRESTORE_EMULATOR_URL = process.env.FIRESTORE_EMULATOR_URL ?? 'http://127.0.0.1:8080';
const PROJECT_ID = process.env.OBC_PROJECT_ID ?? 'demo-obc';
const BASE = `${FIRESTORE_EMULATOR_URL}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

async function deleteAllDocs(collection: string): Promise<void> {
  // List (up to a page — these collections are tiny) and delete each doc by name.
  const res = await fetch(`${BASE}/${collection}?pageSize=300`, { headers: H });
  if (!res.ok) {
    if (res.status === 404) return; // collection has never had a doc
    throw new Error(`reset: could not list ${collection} (HTTP ${res.status})`);
  }
  const body = (await res.json()) as { documents?: Array<{ name: string }> };
  await Promise.all(
    (body.documents ?? []).map((doc) =>
      fetch(`${FIRESTORE_EMULATOR_URL}/v1/${doc.name}`, { method: 'DELETE', headers: H }),
    ),
  );
}

/**
 * Clear everything that gates or records login codes: the rate-limit counters,
 * the outstanding codes, and the outbox. Call before each sign-in so every
 * `requestLoginCode` starts from a clean slate regardless of prior activity.
 */
export async function resetAuthThrottle(): Promise<void> {
  await Promise.all([
    deleteAllDocs('rateLimits'),
    deleteAllDocs('emailCodes'),
    deleteAllDocs('emulatorOutbox'),
  ]);
}

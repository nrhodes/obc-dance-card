/**
 * Shared E2E helper: recover an emailed login code from the emulator-only
 * `emulatorOutbox` collection (see `signin.spec.ts` for the full explanation
 * of why this collection exists and how the `Authorization: Bearer owner`
 * bypass works — it is only valid against the Firestore emulator).
 */
const FIRESTORE_EMULATOR_URL = process.env.FIRESTORE_EMULATOR_URL ?? 'http://127.0.0.1:8080';
const PROJECT_ID = process.env.OBC_PROJECT_ID ?? 'demo-obc';
// Audit L9 — same hard guard as firebase/seed/seed.ts: emulator projects only.
if (!PROJECT_ID.startsWith('demo-')) {
  throw new Error(`emailOutbox helpers refuse project "${PROJECT_ID}" — only demo-* (emulator) projects are allowed.`);
}

export interface OutboxDoc {
  to: string;
  subject: string;
  text: string;
  createdAt: string;
}

/** Structured-query the `emulatorOutbox` collection for docs addressed to `to`. */
async function fetchOutboxDocsFor(to: string): Promise<OutboxDoc[]> {
  const url = `${FIRESTORE_EMULATOR_URL}/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'emulatorOutbox' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'to' },
          op: 'EQUAL',
          value: { stringValue: to },
        },
      },
      orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
      limit: 20,
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `Could not query emulatorOutbox from the Firestore emulator (HTTP ${res.status}). ` +
        'Are the emulators up? See web/README.md.',
    );
  }
  const rows = (await res.json()) as Array<{
    document?: { fields?: Record<string, { stringValue?: string }> };
  }>;
  return rows
    .filter((row) => row.document)
    .map((row) => {
      const fields = row.document!.fields ?? {};
      return {
        to: fields.to?.stringValue ?? '',
        subject: fields.subject?.stringValue ?? '',
        text: fields.text?.stringValue ?? '',
        createdAt: fields.createdAt?.stringValue ?? '',
      };
    });
}

/**
 * Waits for a login-code email addressed to `to` and created at or after
 * `since`, then extracts the 6-digit code from its body. Polls because the
 * outbox write happens slightly after the click that triggers it.
 */
export async function waitForLoginCode(to: string, since: Date): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const docs = await fetchOutboxDocsFor(to);
    const match = docs.find((doc) => new Date(doc.createdAt).getTime() >= since.getTime());
    if (match) {
      const code = /\b(\d{6})\b/.exec(match.text)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No login-code email found for ${to} in emulatorOutbox created after ${since.toISOString()}.`);
}

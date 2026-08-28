/**
 * E2E: sign in with an emailed code, visit Profile, sign out.
 *
 * Requires the emulators + seed running and `npm run dev -w web` serving the
 * app — see `web/README.md` for the exact sequence.
 *
 * Recovering the code: the `console` email provider (plan §11/§13, see
 * `firebase/functions/src/email/provider.ts`) prints the code to the
 * functions emulator's stdout, and — when not deployed — also writes each
 * message to the Firestore collection `emulatorOutbox/{id}`
 * (`{ to, subject, text, createdAt }`). That collection is unreadable by
 * clients (firestore.rules' catch-all denies it); this test reads it via the
 * Firestore emulator's REST API using the emulator's documented
 * `Authorization: Bearer owner` bypass, which only works against the
 * emulator. It picks the newest doc addressed to the sign-in email created
 * after the "Email me a code" click, and pulls the 6 digits out of `text`.
 */
import { expect, test } from '@playwright/test';

const ADMIN_EMAIL = 'admin@example.org';
const FIRESTORE_EMULATOR_URL = process.env.FIRESTORE_EMULATOR_URL ?? 'http://127.0.0.1:8080';
const PROJECT_ID = process.env.OBC_PROJECT_ID ?? 'demo-obc';

interface OutboxDoc {
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
async function waitForLoginCode(to: string, since: Date): Promise<string> {
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

test('sign in by emailed code, view profile, sign out', async ({ page }) => {
  await page.goto('/signin');

  await page.getByLabel('Email address').fill(ADMIN_EMAIL);

  const sentAt = new Date();
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByText(/We've emailed a 6-digit code/)).toBeVisible();

  const code = await waitForLoginCode(ADMIN_EMAIL, sentAt);
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('link', { name: 'Profile' }).click();
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  await expect(page.getByText(ADMIN_EMAIL)).toBeVisible();

  // Both the nav and the Profile screen have a "Sign out" button; use the nav's.
  await page.getByLabel('Main').getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/signin/);
});

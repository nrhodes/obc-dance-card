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
 * emulator (see `support/emailOutbox.ts`). It picks the newest doc addressed
 * to the sign-in email created after the "Email me a code" click, and pulls
 * the 6 digits out of `text`.
 */
import { expect, test } from '@playwright/test';
import { waitForLoginCode } from './support/emailOutbox';

const ADMIN_EMAIL = 'admin@example.org';

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

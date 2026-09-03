/**
 * E2E: sign in as the seeded admin, browse the published 2027 programme,
 * open a session, and see its (empty) roster.
 *
 * Requires the emulators + seed running and `npm run dev -w web` serving the
 * app — see `web/README.md`. The seed (`firebase/seed/seed.ts`) imports and
 * publishes a 2027 programme whose Monday page includes "Marion Taylor
 * Pairs" starting `2027-01-11` — this test does not depend on the real
 * calendar date, only on that fixed, published programme.
 */
import { expect, test } from './support/fixtures';
import { waitForLoginCode } from './support/emailOutbox';

const ADMIN_EMAIL = 'admin@example.org';

test('sign in, browse the programme, open a session', async ({ page }) => {
  await page.goto('/signin');
  await page.getByLabel('Email address').fill(ADMIN_EMAIL);
  const sentAt = new Date();
  await page.getByRole('button', { name: 'Email me a code' }).click();
  const code = await waitForLoginCode(ADMIN_EMAIL, sentAt);
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible({ timeout: 15_000 });

  await page.getByLabel('Main').getByRole('link', { name: 'Programme', exact: true }).click();
  await expect(page.getByRole('heading', { name: /2027 Programme/ })).toBeVisible();

  // The default tab is today's real-world weekday (Mon-Fri) or Monday — pick
  // Monday explicitly so this test doesn't depend on the day it happens to run.
  await page.getByRole('tab', { name: 'Mon' }).click();
  await expect(page.getByRole('tab', { name: 'Mon' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Marion Taylor Pairs')).toBeVisible();

  await page.getByRole('link', { name: /Mon 11 Jan 2027/ }).click();
  await expect(page.getByRole('heading', { name: 'Marion Taylor Pairs' })).toBeVisible();
  await expect(page.getByText('Nobody has signed up yet.')).toBeVisible();
});

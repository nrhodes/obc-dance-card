/**
 * E2E: the Members directory (`/members`, docs/implementation-plan.md §2
 * visibility row, amended 2026-09-05 — every active member sees every other
 * active member's name, grade, phone, and email). Signs in as a seeded
 * ordinary member — `robert.king@example.org`, unused by any other spec
 * (see `visitors.spec.ts`'s header comment on the per-email rate-limit
 * budget) — and confirms a *different* seeded member (John Smith) shows up
 * with working `tel:`/`mailto:` links.
 *
 * Requires the emulators + seed + dev server already running (see
 * `web/README.md`).
 */
import { expect, test } from './support/fixtures';
import { waitForLoginCode } from './support/emailOutbox';

const MEMBER_EMAIL = 'robert.king@example.org';
const OTHER_MEMBER_NAME = 'John Smith';
const OTHER_MEMBER_PHONE = '021 555 0101';
const OTHER_MEMBER_EMAIL = 'john.smith@example.org';

test('a signed-in member browses the Members directory', async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto('/signin');
  await page.getByLabel('Email address').fill(MEMBER_EMAIL);
  const sentAt = new Date();
  await page.getByRole('button', { name: 'Email me a code' }).click();
  const code = await waitForLoginCode(MEMBER_EMAIL, sentAt);
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible({ timeout: 15_000 });

  await page.getByLabel('Main').getByRole('link', { name: 'Members' }).click();
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();

  const row = page.getByRole('row', { name: new RegExp(OTHER_MEMBER_NAME) });
  await expect(row).toBeVisible();
  const phoneLink = row.getByRole('link', { name: new RegExp(`Call ${OTHER_MEMBER_NAME}`) });
  await expect(phoneLink).toHaveAttribute('href', `tel:${OTHER_MEMBER_PHONE}`);
  const emailLink = row.getByRole('link', { name: new RegExp(`Email ${OTHER_MEMBER_NAME}`) });
  await expect(emailLink).toHaveAttribute('href', `mailto:${OTHER_MEMBER_EMAIL}`);

  // Search filters by name.
  await page.getByLabel('Search by name').fill('Smith');
  await expect(row).toBeVisible();
  await page.getByLabel('Search by name').fill('Zzz-no-such-member');
  await expect(page.getByText('No members match.')).toBeVisible();
});

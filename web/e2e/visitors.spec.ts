/**
 * E2E: the visitors cold cycle (plan §12, Phase 4c task). Signs in as a
 * seeded ordinary member — `peter.wilson@example.org`, not the seeded admin
 * or `john.smith@example.org` — so this spec never shares
 * `requestLoginCode`'s per-email rate-limit budget (plan §8.1: 3
 * requests/email/15 min) with `signin.spec.ts` / `programme.spec.ts` /
 * `dancecard.spec.ts`. Adding a visitor and signing up with one doesn't
 * require the admin role, so any member will do.
 *
 * Walks: adds a visitor from Profile ("My visitors") -> opens the seeded
 * **Campbell Cave Pairs** session (Monday, first date 2027-02-08 — a date no
 * other spec uses, so this spec's sign-up traffic never collides with
 * another spec's roster assertion on the same session) -> "Play with a
 * visitor" -> the roster shows "<name> (visitor)".
 *
 * Requires the emulators + seed + dev server already running (see
 * `web/README.md`); relies on the seed's fixed, published 2027 programme,
 * and is a cold-cycle test: it assumes a freshly seeded emulator (re-running
 * without re-seeding will find Peter already committed on this session).
 */
import { expect, test } from './support/fixtures';
import { waitForLoginCode } from './support/emailOutbox';

const MEMBER_EMAIL = 'peter.wilson@example.org';
const SESSION_PATH = '/session/2027/monday-campbell-cave-pairs-2027-02-08';
const VISITOR_NAME = 'Vera Visitor';

test('a member adds a visitor and signs up to play with them', async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto('/signin');
  await page.getByLabel('Email address').fill(MEMBER_EMAIL);
  const sentAt = new Date();
  await page.getByRole('button', { name: 'Email me a code' }).click();
  const code = await waitForLoginCode(MEMBER_EMAIL, sentAt);
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible({ timeout: 15_000 });

  // Add a visitor from Profile -> "My visitors".
  await page.getByLabel('Main').getByRole('link', { name: 'Profile' }).click();
  await page.getByRole('link', { name: 'Manage my visitors' }).click();
  await expect(page.getByRole('heading', { name: 'My visitors' })).toBeVisible();
  await page.getByRole('button', { name: 'Add a visitor' }).click();
  await page.getByLabel('Name').fill(VISITOR_NAME);
  await page.getByRole('button', { name: 'Add visitor' }).click();
  await expect(page.getByText(`${VISITOR_NAME} added.`)).toBeVisible();

  // Open the Pairs session and play with the visitor.
  await page.goto(SESSION_PATH);
  await expect(page.getByRole('heading', { name: 'Campbell Cave Pairs' })).toBeVisible();
  await page.getByRole('button', { name: 'Play with a visitor' }).click();
  await page.getByRole('button', { name: VISITOR_NAME }).click();
  await expect(page.getByText('Signed up to play with your visitor.')).toBeVisible();

  await expect(page.getByText(`Peter Wilson & ${VISITOR_NAME} (visitor)`)).toBeVisible();
});

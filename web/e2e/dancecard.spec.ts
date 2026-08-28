/**
 * E2E: the card-core cold cycle (plan Phase 3b task). Two browser contexts —
 * the seeded admin and a seeded ordinary member — sign in with an emailed
 * code (a *different* email each, so this spec doesn't share
 * `requestLoginCode`'s per-email rate limit budget with `signin.spec.ts` /
 * `programme.spec.ts`, both of which sign in `admin@example.org` once each).
 *
 * Walks: admin lists themselves "Looking for a partner" on a future Monday
 * session -> the second member claims it ("Play with Admin User") -> both My
 * Dance Cards show the pairing -> admin cancels -> the second member's card
 * flips back to "Looking for a partner" and their Notifications shows "Your
 * partner cancelled".
 *
 * Requires the emulators + seed + dev server already running (see
 * `web/README.md`); relies on the seed's fixed, published 2027 programme —
 * a *different* Monday "Marion Taylor Pairs" date (2027-01-18) than
 * `programme.spec.ts` uses (2027-01-11), so this spec's pairing/cancel
 * traffic never collides with that spec's "Nobody has signed up yet."
 * assertion on the same session — and is a cold-cycle test: it assumes a
 * freshly seeded emulator (re-running against the same data without
 * re-seeding will find the session already paired/cancelled from the
 * previous run).
 */
import { expect, test, type Page } from '@playwright/test';
import { waitForLoginCode } from './support/emailOutbox';

const ADMIN_EMAIL = 'admin@example.org';
const MEMBER_EMAIL = 'john.smith@example.org';
const SESSION_PATH = '/session/2027/monday-marion-taylor-pairs-2027-01-18';

async function signIn(page: Page, email: string) {
  await page.goto('/signin');
  await page.getByLabel('Email address').fill(email);
  const sentAt = new Date();
  await page.getByRole('button', { name: 'Email me a code' }).click();
  const code = await waitForLoginCode(email, sentAt);
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible({ timeout: 15_000 });
}

test('a member claims another member\'s "looking for a partner" listing, then the poster cancels', async ({ browser }) => {
  test.setTimeout(90_000);

  const adminContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const memberPage = await memberContext.newPage();

  try {
    await signIn(adminPage, ADMIN_EMAIL);
    await signIn(memberPage, MEMBER_EMAIL);

    // Admin opens the session and lists themselves as looking for a partner.
    await adminPage.goto(SESSION_PATH);
    await expect(adminPage.getByRole('heading', { name: 'Marion Taylor Pairs' })).toBeVisible();
    await adminPage.getByRole('button', { name: "I'm looking for a partner" }).click();
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
    await expect(adminPage.getByText("You're now looking for a partner.")).toBeVisible();

    // The second member opens the same session and sees + claims the listing.
    await memberPage.goto(SESSION_PATH);
    const claimButton = memberPage.getByRole('button', { name: 'Play with Admin User' });
    await expect(claimButton).toBeVisible();
    await claimButton.click();
    await memberPage.getByRole('dialog').getByRole('button', { name: 'Play with them' }).click();
    await expect(memberPage.getByText("You're now playing with Admin User.")).toBeVisible();

    // Both My Dance Cards show the pairing.
    await adminPage.goto('/');
    await expect(adminPage.getByText(/with John Smith/)).toBeVisible();
    await memberPage.goto('/');
    await expect(memberPage.getByText(/with Admin User/)).toBeVisible();

    // The admin cancels; the second member is freed to look for a partner and notified.
    await adminPage.goto(SESSION_PATH);
    await adminPage.getByRole('button', { name: 'Cancel this session' }).click();
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Cancel this session' }).click();
    await expect(adminPage.getByText('Your entry for this session has been cancelled.')).toBeVisible();

    await memberPage.goto(SESSION_PATH);
    await expect(memberPage.getByText("You're looking for a partner.")).toBeVisible();

    await memberPage.getByLabel('Main').getByRole('link', { name: /Notifications/ }).click();
    await expect(memberPage.getByText('Your partner cancelled')).toBeVisible();
  } finally {
    await adminContext.close();
    await memberContext.close();
  }
});

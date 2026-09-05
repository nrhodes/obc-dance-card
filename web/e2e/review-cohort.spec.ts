/**
 * E2E: App-Store-review cohort partition (plan §8.1, decided 2026-09-05).
 * The seed (`firebase/seed/seed.ts`) provisions `SEED_REVIEW_COUNT` (2)
 * `cohort: 'review'` members — Ted TEST01 Jones / Sally TEST02 Smith, test01/02@
 * `SEED_REVIEW_DOMAIN`, password `SEED_REVIEW_PASSWORD` — via the exact same
 * `provisionReviewMembers` path `firebase/scripts/provision-review-cohort.ts`
 * uses (see that file's header). Values are duplicated as local consts below
 * rather than imported, since `web/` cannot import from `firebase/seed`
 * (separate package, no shared tsconfig path) — keep them in sync with
 * `firebase/seed/seed.ts` if either changes.
 *
 * This spec is deliberately self-contained (does not depend on what other
 * spec files have or haven't done to shared programme dates — same
 * convention `dancecard.spec.ts`/`visitors.spec.ts`/`admin.spec.ts` already
 * follow, each picking a date "no other spec uses"): it first signs in as a
 * real club member and creates a real, visible "looking for a partner"
 * listing on a session no other spec touches, THEN signs in as a reviewer
 * and asserts that listing — and the club member's name in the Members
 * directory generally — is completely invisible. Direction two (reviewers
 * invisible to club members) is checked at the end.
 *
 * Requires the emulators + seed + dev server already running (see
 * `web/README.md`).
 */
import { expect, test } from './support/fixtures';
import { type Page } from '@playwright/test';
import { waitForLoginCode } from './support/emailOutbox';

// Kept in sync with firebase/seed/seed.ts's SEED_REVIEW_* constants.
const REVIEWER1_EMAIL = 'test01@reviewer.example.test';
const REVIEWER2_NAME = 'Sally TEST02 Smith';
const REVIEWER_PASSWORD = 'ci-dev-reviewer-pw-1';

// A club member + session date no other e2e spec references (see header).
const CLUB_MEMBER_EMAIL = 'karen.wright@example.org';
const CLUB_MEMBER_NAME = 'Karen Wright';
const CLUB_SESSION_PATH = '/session/2027/monday-campbell-cave-pairs-2027-02-22';

// A second, distinct future session for the reviewer-to-reviewer invite —
// unused by any other spec — so it starts with no entry either side.
const REVIEWER_INVITE_SESSION_PATH = '/session/2027/monday-marion-taylor-pairs-2027-01-25';

async function signInByCode(page: Page, email: string) {
  await page.goto('/signin');
  await page.getByLabel('Email address').fill(email);
  const sentAt = new Date();
  await page.getByRole('button', { name: 'Email me a code' }).click();
  const code = await waitForLoginCode(email, sentAt);
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible({ timeout: 15_000 });
}

async function signInByPassword(page: Page, email: string, password: string) {
  await page.goto('/signin');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'I have a password' }).click();
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible({ timeout: 15_000 });
}

async function signOut(page: Page) {
  await page.getByLabel('Main').getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/signin/);
}

test('the review cohort and the club are invisible to each other', async ({ page }) => {
  test.setTimeout(90_000);

  // ---- Part 1: a real club member creates real, visible activity ----
  await signInByCode(page, CLUB_MEMBER_EMAIL);
  await page.goto(CLUB_SESSION_PATH);
  await expect(page.getByRole('heading', { name: 'Campbell Cave Pairs' })).toBeVisible();
  await page.getByRole('button', { name: "I'm looking for a partner" }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText("You're now looking for a partner.")).toBeVisible();
  await signOut(page);

  // ---- Part 2: sign in as a reviewer (password auth) ----
  await signInByPassword(page, REVIEWER1_EMAIL, REVIEWER_PASSWORD);

  // Members page shows ONLY the review cohort — exactly the seeded count,
  // and never the club member who just signed up above.
  await page.getByLabel('Main').getByRole('link', { name: 'Members' }).click();
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(REVIEWER2_NAME) })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByText(CLUB_MEMBER_NAME)).not.toBeVisible();

  // A real session the club member just used shows no trace of them.
  await page.goto(CLUB_SESSION_PATH);
  await expect(page.getByRole('heading', { name: 'Campbell Cave Pairs' })).toBeVisible();
  await expect(page.getByText(CLUB_MEMBER_NAME)).not.toBeVisible();

  // Invite the other reviewer and see the pending state.
  await page.goto(REVIEWER_INVITE_SESSION_PATH);
  await expect(page.getByRole('heading', { name: 'Marion Taylor Pairs' })).toBeVisible();
  await page.getByRole('button', { name: 'Invite a partner' }).click();
  await page.getByRole('button', { name: new RegExp(REVIEWER2_NAME) }).click();
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByRole('heading', { name: 'Waiting for a reply' })).toBeVisible();
  await expect(page.getByText(new RegExp(`invited.*${REVIEWER2_NAME}`))).toBeVisible();

  // Leave state clean.
  await page.getByRole('button', { name: 'Cancel invitation' }).click();
  await expect(page.getByRole('heading', { name: 'Waiting for a reply' })).not.toBeVisible();
  await signOut(page);

  // ---- Part 3: sign back in as the club member — reviewers are invisible ----
  await signInByCode(page, CLUB_MEMBER_EMAIL);
  await page.getByLabel('Main').getByRole('link', { name: 'Members' }).click();
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
  await expect(page.getByText(REVIEWER2_NAME)).not.toBeVisible();
  await expect(page.getByText('Ted TEST01 Jones')).not.toBeVisible();
});

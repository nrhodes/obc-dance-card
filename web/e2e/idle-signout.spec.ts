/**
 * Regression for incident 2026-11-17: the idle sign-out rule (plan §8.1
 * shared devices — a session idle for 30+ days is signed out on next load)
 * fired against a *fresh* sign-in, because signing in never refreshed the
 * `obc.lastActivityAt` stamp and the stamp was never cleared. A browser that
 * had last seen the app in September bounced every sign-in back to the
 * sign-in screen the instant the card rendered, until its site data was
 * wiped. Reproduced and fixed in PR #130 (AuthProvider stamps a fresh
 * sign-in; useIdleSignOut forgets the stamp when it fires).
 *
 * Two scenarios, run against the seeded reviewer (password auth, so no login
 * code is needed; `review-cohort.spec.ts` uses the same account and signs
 * out after itself):
 *  1. a 40-day-old stamp must NOT sign out a member who has just signed in;
 *  2. the rule must still sign out a session merely *restored* after 40 days
 *     idle — that is the shared-device behaviour the plan asks for.
 */
import { expect, test } from './support/fixtures';
import { type Page } from '@playwright/test';

// Kept in sync with firebase/seed/seed.ts's SEED_REVIEW_* constants.
const REVIEWER_EMAIL = 'test01@reviewer.example.test';
const REVIEWER_PASSWORD = 'ci-dev-reviewer-pw-1';
const STAMP_KEY = 'obc.lastActivityAt';
const FORTY_DAYS_MS = 40 * 24 * 60 * 60 * 1000;

async function signInByPassword(page: Page) {
  await page.getByLabel('Email address').fill(REVIEWER_EMAIL);
  await page.getByRole('button', { name: 'I have a password' }).click();
  await page.getByLabel('Password').fill(REVIEWER_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function setStaleStamp(page: Page) {
  await page.evaluate(
    ([key, ms]) => localStorage.setItem(key as string, String(Date.now() - (ms as number))),
    [STAMP_KEY, FORTY_DAYS_MS],
  );
}

test('a fresh sign-in is activity: a 40-day-old stamp does not sign the member straight back out', async ({ page }) => {
  await page.goto('/signin');
  await setStaleStamp(page);
  await page.reload();
  await signInByPassword(page);

  const hello = page.getByRole('heading', { name: /Hello/ });
  await expect(hello).toBeVisible({ timeout: 15_000 });
  // The bounce happened within a second of the card rendering; make sure we
  // are still here well after that, and that sign-in refreshed the stamp.
  await page.waitForTimeout(3_000);
  await expect(hello).toBeVisible();
  const stamp = Number(await page.evaluate((key) => localStorage.getItem(key), STAMP_KEY));
  expect(Date.now() - stamp).toBeLessThan(60_000);

  // Leave the shared account signed out for the next spec.
  await page.evaluate((key) => localStorage.removeItem(key), STAMP_KEY);
  await page.goto('/profile');
  await page.getByRole('button', { name: /Sign out/ }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 15_000 });
});

test('a session restored after 40 days idle is still signed out on load, and the stamp is forgotten', async ({ page }) => {
  await page.goto('/signin');
  await signInByPassword(page);
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible({ timeout: 15_000 });

  // Simulate the browser sitting idle, then being reopened with the
  // persisted session.
  await setStaleStamp(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 15_000 });
  // The stale stamp must be gone. (It may have been re-stamped "now" by a
  // second effect run — React StrictMode in the dev server mounts effects
  // twice — which is harmless; what matters is that the 40-day-old value
  // cannot poison the next sign-in.)
  const after = await page.evaluate((key) => localStorage.getItem(key), STAMP_KEY);
  expect(after === null || Date.now() - Number(after) < 60_000).toBe(true);
});

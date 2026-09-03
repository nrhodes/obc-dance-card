/**
 * Shared, robust "sign in by emailed code" flow for the E2E specs. Resets the
 * auth-throttling state first (see `reset.ts`) so repeated/parallel sign-ins
 * never trip the rate limit, requests a code, reads it from the emulator
 * outbox, and waits for the app to land on the member's card.
 */
import { expect, type Page } from '@playwright/test';
import { waitForLoginCode } from './emailOutbox';
import { resetAuthThrottle } from './reset';

export async function signInByCode(page: Page, email: string): Promise<void> {
  await resetAuthThrottle();
  await page.goto('/signin');
  await page.getByLabel('Email address').fill(email);
  const sentAt = new Date();
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByText(/We've emailed a 6-digit code/)).toBeVisible();
  const code = await waitForLoginCode(email, sentAt);
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible({ timeout: 20_000 });
}

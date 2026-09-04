/**
 * E2E: the iCal subscription feed cold cycle (plan §21 B1). Signs in as
 * `linda.young@example.org` — a seeded member no other spec uses, so this
 * spec never shares `requestLoginCode`'s per-email rate-limit budget with
 * another spec's sign-in.
 *
 * Walks: Profile -> "Create calendar link" -> reads the displayed URL ->
 * fetches it directly against the functions emulator (the URL points at
 * `WEB_APP_BASE_URL=http://localhost:5173/ical/...`, which the Vite dev
 * server does not serve — the token is extracted from the displayed URL and
 * fetched at `http://127.0.0.1:5001/demo-obc/australia-southeast1/icalFeed/
 * <token>.ics` instead, the direct functions-emulator URL for the `icalFeed`
 * HTTP function) -> asserts 200 + `BEGIN:VCALENDAR` -> "Reset link" ->
 * asserts the OLD token now 404s and the new one works -> "Remove link" to
 * leave state clean.
 *
 * Requires the emulators + seed + dev server already running (see
 * `web/README.md`).
 */
import { expect, test } from './support/fixtures';
import { waitForLoginCode } from './support/emailOutbox';

const MEMBER_EMAIL = 'linda.young@example.org';
const FUNCTIONS_EMULATOR_BASE =
  process.env.FUNCTIONS_EMULATOR_URL ?? 'http://127.0.0.1:5001/demo-obc/australia-southeast1';

function tokenFromUrl(url: string): string {
  const match = /\/ical\/([^/]+)\.ics$/.exec(url);
  if (!match) throw new Error(`could not extract token from displayed URL: ${url}`);
  return match[1]!;
}

test('a member creates, resets, and removes their calendar feed link', async ({ page, request }) => {
  test.setTimeout(60_000);

  await page.goto('/signin');
  await page.getByLabel('Email address').fill(MEMBER_EMAIL);
  const sentAt = new Date();
  await page.getByRole('button', { name: 'Email me a code' }).click();
  const code = await waitForLoginCode(MEMBER_EMAIL, sentAt);
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible({ timeout: 15_000 });

  await page.getByLabel('Main').getByRole('link', { name: 'Profile' }).click();
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Calendar feed' })).toBeVisible();

  await page.getByRole('button', { name: 'Create calendar link' }).click();
  const urlInput = page.getByLabel('Your calendar link');
  await expect(urlInput).toBeVisible();
  const url1 = await urlInput.inputValue();
  const token1 = tokenFromUrl(url1);

  const feedResponse1 = await request.get(`${FUNCTIONS_EMULATOR_BASE}/icalFeed/${token1}.ics`);
  expect(feedResponse1.status()).toBe(200);
  expect(await feedResponse1.text()).toContain('BEGIN:VCALENDAR');

  // Reset — old token must stop working, new one must work.
  await page.getByRole('button', { name: 'Reset link' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Reset link' }).click();
  await expect(dialog).toBeHidden();

  await expect
    .poll(async () => await urlInput.inputValue())
    .not.toBe(url1);
  const url2 = await urlInput.inputValue();
  const token2 = tokenFromUrl(url2);
  expect(token2).not.toBe(token1);

  const oldFeedResponse = await request.get(`${FUNCTIONS_EMULATOR_BASE}/icalFeed/${token1}.ics`);
  expect(oldFeedResponse.status()).toBe(404);

  const newFeedResponse = await request.get(`${FUNCTIONS_EMULATOR_BASE}/icalFeed/${token2}.ics`);
  expect(newFeedResponse.status()).toBe(200);
  expect(await newFeedResponse.text()).toContain('BEGIN:VCALENDAR');

  // Remove — leave state clean for any re-run.
  await page.getByRole('button', { name: 'Remove link' }).click();
  const removeDialog = page.getByRole('dialog');
  await expect(removeDialog).toBeVisible();
  await removeDialog.getByRole('button', { name: 'Remove link' }).click();
  await expect(page.getByRole('button', { name: 'Create calendar link' })).toBeVisible();

  const removedFeedResponse = await request.get(`${FUNCTIONS_EMULATOR_BASE}/icalFeed/${token2}.ics`);
  expect(removedFeedResponse.status()).toBe(404);
});

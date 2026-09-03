/**
 * E2E: the Teams cold cycle (plan §12A, Phase 4c task). Two browser contexts
 * — two seeded ordinary members, *not* the seeded admin or
 * `john.smith@example.org` — sign in with an emailed code: `mary.brown@example.org`
 * and `alex.taylor@example.org`, neither of which any other spec signs in,
 * so this spec never shares `requestLoginCode`'s per-email rate-limit budget
 * (plan §8.1: 3 requests/email/15 min) with `signin.spec.ts` /
 * `programme.spec.ts` / `dancecard.spec.ts` (all of which sign in
 * `admin@example.org`, and the latter also `john.smith@example.org`).
 * Starting a team or accepting a team invite doesn't require the admin role,
 * so any two members will do.
 *
 * Walks: Mary opens the seeded **Campbell Cave Teams** series session
 * (Monday, first date 2027-09-20) and starts a team -> invites Alex -> Alex
 * accepts the invite from their Invites inbox -> both see the team with 2
 * members and status Forming on the session page.
 *
 * Requires the emulators + seed + dev server already running (see
 * `web/README.md`); relies on the seed's fixed, published 2027 programme,
 * and is a cold-cycle test: it assumes a freshly seeded emulator (re-running
 * without re-seeding will find Mary already captaining a team in this
 * series, and `createTeam` will fail with "You are already on a team for
 * this series.").
 */
import { expect, test } from './support/fixtures';
import { type Page } from '@playwright/test';
import { waitForLoginCode } from './support/emailOutbox';

const CAPTAIN_EMAIL = 'mary.brown@example.org';
const MEMBER_EMAIL = 'alex.taylor@example.org';
const SESSION_PATH = '/session/2027/monday-campbell-cave-teams-2027-09-20';

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

test('a captain starts a team, invites a member, and the member accepts', async ({ browser }) => {
  test.setTimeout(90_000);

  const captainContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const captainPage = await captainContext.newPage();
  const memberPage = await memberContext.newPage();

  try {
    await signIn(captainPage, CAPTAIN_EMAIL);
    await signIn(memberPage, MEMBER_EMAIL);

    // Mary opens the Teams session and starts a team (default name: "Brown team").
    await captainPage.goto(SESSION_PATH);
    await expect(captainPage.getByRole('heading', { name: 'Campbell Cave Teams' })).toBeVisible();
    await captainPage.getByRole('button', { name: 'Start a team' }).click();
    await captainPage.getByRole('dialog').getByRole('button', { name: 'Start team' }).click();
    await expect(captainPage.getByText('Team started.')).toBeVisible();
    await expect(captainPage.getByRole('heading', { name: 'Brown team', level: 3 }).last()).toBeVisible();
    await expect(captainPage.getByText(/Forming \(1 of 4–6\)/)).toBeVisible();

    // Mary invites Alex.
    await captainPage.getByRole('button', { name: 'Invite a member' }).click();
    await captainPage.getByLabel('Search members').fill('Alex');
    await captainPage.getByRole('button', { name: /Alex Taylor/ }).click();
    await captainPage.getByRole('dialog').getByRole('button', { name: 'Send invite' }).click();
    await expect(captainPage.getByText('Invite sent.')).toBeVisible();

    // Alex sees and accepts the team invite from their Invites inbox.
    await memberPage.getByLabel('Main').getByRole('link', { name: /Invites/ }).click();
    await expect(memberPage.getByText('Team invite from Mary Brown — Brown team (Campbell Cave Teams)')).toBeVisible();
    await memberPage.getByRole('button', { name: 'Accept' }).click();
    // Wait for the accept to land (the live inbox drops the card once the
    // invite is no longer pending) before navigating — navigating first would
    // cancel the in-flight callable.
    await expect(
      memberPage.getByText('Team invite from Mary Brown — Brown team (Campbell Cave Teams)'),
    ).toBeHidden({ timeout: 15_000 });

    // Both now see the team with 2 members, status Forming (still below teamMin=4).
    await memberPage.goto(SESSION_PATH);
    await expect(memberPage.getByRole('heading', { name: 'Brown team', level: 3 }).last()).toBeVisible();
    await expect(memberPage.getByText(/Forming \(2 of 4–6\)/)).toBeVisible();
    await expect(memberPage.getByText('Alex Taylor').last()).toBeVisible();
    await expect(memberPage.getByRole('button', { name: 'Leave team' })).toBeVisible();

    await captainPage.reload();
    await expect(captainPage.getByText(/Forming \(2 of 4–6\)/)).toBeVisible();
    await expect(captainPage.getByText('Alex Taylor').last()).toBeVisible();
  } finally {
    await captainContext.close();
    await memberContext.close();
  }
});

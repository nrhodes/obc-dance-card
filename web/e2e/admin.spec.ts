/**
 * E2E: the admin cold cycle (plan §2 Act-on-behalf, §9.2 admin rows, Phase
 * 6b task). Signs in as the seeded admin only (`admin@example.org`) plus a
 * second context as `susan.clark@example.org` — neither seeded member any
 * other spec signs in — so this spec doesn't share `requestLoginCode`'s
 * per-email rate-limit budget (plan §8.1: 3 requests/email/15 min) with
 * `signin.spec.ts` / `programme.spec.ts` / `dancecard.spec.ts` (all of which
 * sign in `admin@example.org` too — see `web/README.md` for why this spec is
 * run as its own batch against a fresh seed rather than alongside those).
 *
 * Walks: admin signs in -> Admin: Members -> "Act on behalf" of Susan Clark
 * -> opens the seeded **Campbell Cave Pairs** session (Monday, second date
 * 2027-02-15 — a date no other spec uses) -> "I'm looking for a partner" ->
 * the roster shows Susan Clark, not the admin -> stops acting -> Admin:
 * Audit log, filtered to `set_solo_status_on_behalf`, shows a row with the
 * admin as actor and Susan Clark as target -> Admin: Integrity -> Run check
 * shows 0 violations -> Admin: Broadcast -> sends a broadcast -> Susan's
 * Notifications (second context) shows it.
 *
 * Requires the emulators + seed + dev server already running (see
 * `web/README.md`); relies on the seed's fixed, published 2027 programme,
 * and is a cold-cycle test: it assumes a freshly seeded emulator (broadcast
 * has a 5/day rate limit and the sweep/audit-log assertions assume no other
 * spec's traffic has run first).
 */
import { expect, test } from './support/fixtures';
import { type Page } from '@playwright/test';
import { waitForLoginCode } from './support/emailOutbox';

const ADMIN_EMAIL = 'admin@example.org';
const MEMBER_EMAIL = 'susan.clark@example.org';
const MEMBER_NAME = 'Susan Clark';

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


async function openAdmin(page: Page, child: string): Promise<void> {
  // The admin links live behind an "Admin" disclosure that closes on each
  // navigation, so re-open it each time. In-app (SPA) clicks preserve the
  // in-memory "acting on behalf" state that a full page.goto would reset.
  await page.getByLabel('Main').getByRole('button', { name: /Admin/ }).click();
  await page.getByLabel('Main').getByRole('link', { name: child, exact: true }).click();
}


test('admin acts on behalf of a member, audits it, checks integrity, and broadcasts', async ({ browser }) => {
  test.setTimeout(120_000);

  const adminContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const memberPage = await memberContext.newPage();

  try {
    await signIn(adminPage, ADMIN_EMAIL);

    // ---- Admin: Members -> Act on behalf ----
    await openAdmin(adminPage, 'Members');
    await expect(adminPage.getByRole('heading', { name: 'Members' })).toBeVisible();
    await adminPage.getByLabel('Search by name').fill('Susan Clark');
    const memberRow = adminPage.getByRole('row', { name: new RegExp(MEMBER_NAME) });
    await expect(memberRow).toBeVisible();
    await memberRow.getByRole('button', { name: 'Act on behalf' }).click();
    await expect(adminPage.getByText(`Now acting on behalf of ${MEMBER_NAME}.`)).toBeVisible();
    const actingAsBanner = adminPage.locator('.acting-as-banner');
    await expect(actingAsBanner).toBeVisible();
    await expect(actingAsBanner.getByText(MEMBER_NAME)).toBeVisible();

    // ---- Open the Pairs session and list "looking for a partner" ----
    // Navigated via in-app links (not `page.goto`, which is a full browser
    // navigation that would remount the SPA and lose the in-memory
    // `ActingAsProvider` state — plan Phase 6b task: acting-as is
    // deliberately not persisted across a reload, the safer default).
    await adminPage.getByLabel('Main').getByRole('link', { name: 'Programme', exact: true }).click();
    await adminPage.getByRole('tab', { name: 'Mon' }).click();
    await adminPage.getByRole('link', { name: /Mon 15 Feb 2027/ }).click();
    await expect(adminPage.getByRole('heading', { name: 'Campbell Cave Pairs' })).toBeVisible();
    await adminPage.getByRole('button', { name: "I'm looking for a partner" }).click();
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
    await expect(adminPage.getByText("You're now looking for a partner.")).toBeVisible();

    // The roster shows Susan Clark (the acted-on member), not the admin.
    const rosterCard = adminPage.locator('.card', { has: adminPage.getByRole('heading', { name: "Who's playing" }) });
    await expect(rosterCard.getByRole('heading', { name: 'Looking for a partner' })).toBeVisible();
    await expect(rosterCard.getByText(MEMBER_NAME)).toBeVisible();
    await expect(rosterCard.getByText('Admin User')).toHaveCount(0);

    // ---- Stop acting ----
    await adminPage.getByRole('button', { name: 'Stop' }).click();
    await expect(actingAsBanner).toHaveCount(0);

    // ---- Admin: Audit log ----
    await openAdmin(adminPage, 'Audit log');
    await adminPage.getByLabel('Filter by').selectOption('action');
    await adminPage.getByLabel('Action').selectOption('set_solo_status_on_behalf');
    const auditRow = adminPage.getByRole('row', { name: /set_solo_status_on_behalf/ });
    await expect(auditRow).toBeVisible();
    await expect(auditRow.getByText('Admin User')).toBeVisible();
    await expect(auditRow.getByText(MEMBER_NAME)).toBeVisible();

    // ---- Admin: Integrity ----
    await openAdmin(adminPage, 'Integrity');
    await adminPage.getByRole('button', { name: 'Run check', exact: true }).click();
    await expect(adminPage.getByText('Violations found: 0')).toBeVisible({ timeout: 15_000 });
    await expect(adminPage.getByText('No violations found.')).toBeVisible();

    // ---- Admin: Broadcast ----
    await memberPage.goto('/'); // start Susan's sign-in before the broadcast fires, so no polling race
    await signIn(memberPage, MEMBER_EMAIL);

    await openAdmin(adminPage, 'Broadcast');
    const broadcastTitle = 'Club news';
    const broadcastBody = 'The car park will be resealed next weekend.';
    await adminPage.getByLabel(/Title/).fill(broadcastTitle);
    await adminPage.getByLabel(/Message/).fill(broadcastBody);
    await adminPage.getByRole('button', { name: 'Preview & send' }).click();
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Send' }).click();
    await expect(adminPage.getByText(/Sent to \d+ member/)).toBeVisible();

    // Susan's Notifications (second context) shows the broadcast.
    await memberPage.getByLabel('Main').getByRole('link', { name: /Notifications/ }).click();
    await expect(memberPage.getByText(broadcastTitle)).toBeVisible({ timeout: 15_000 });
  } finally {
    await adminContext.close();
    await memberContext.close();
  }
});

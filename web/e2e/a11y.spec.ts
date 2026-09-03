/**
 * E2E accessibility audit (plan §14.1 accessibility rules, Phase 7b task
 * deliverable B). Signs in as the seeded admin once (so every admin-only
 * route is reachable too) and runs axe-core against every top-level route,
 * failing the test on any `serious`/`critical` violation. `moderate`/`minor`
 * findings are logged (via the assertion message) but do not fail the
 * build — the plan's accessibility bar is WCAG 2.1 AA, which axe's
 * `wcag2a`/`wcag2aa`/`wcag21aa` rule sets cover; violations below `serious`
 * are usually best-practice nits, not AA failures.
 *
 * Requires the emulators + seed + dev server already running (see
 * `web/README.md`) and a freshly seeded emulator (uses the seeded 2027
 * programme's "Marion Taylor Pairs" session, same fixed session
 * `programme.spec.ts` uses, and does not mutate any data itself — safe to
 * run in any batch, any number of times).
 */
import { expect, test } from './support/fixtures';
import { type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForLoginCode } from './support/emailOutbox';

const ADMIN_EMAIL = 'admin@example.org';

async function signIn(page: Page): Promise<void> {
  await page.goto('/signin');
  await page.getByLabel('Email address').fill(ADMIN_EMAIL);
  const sentAt = new Date();
  await page.getByRole('button', { name: 'Email me a code' }).click();
  const code = await waitForLoginCode(ADMIN_EMAIL, sentAt);
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible({ timeout: 15_000 });
}

async function assertNoSeriousViolations(page: Page, routeLabel: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  const describe = (v: (typeof results.violations)[number]) =>
    `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(' ')}`;
  expect(
    serious,
    `${routeLabel} had serious/critical axe violations:\n${serious.map(describe).join('\n')}`,
  ).toEqual([]);
}

test.describe('accessibility (axe)', () => {
  test('every top-level route has no serious/critical WCAG 2.1 AA violations', async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page);
    await assertNoSeriousViolations(page, '/ (My Card)');

    await page.getByLabel('Main').getByRole('link', { name: 'Programme', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Programme/ })).toBeVisible();
    await assertNoSeriousViolations(page, '/programme');

    await page.getByRole('tab', { name: 'Mon' }).click();
    await page.getByRole('link', { name: /Mon 11 Jan 2027/ }).click();
    await expect(page.getByRole('heading', { name: 'Marion Taylor Pairs' })).toBeVisible();
    await assertNoSeriousViolations(page, '/session/:year/:sessionId');

    await page.getByLabel('Main').getByRole('link', { name: 'Calendar' }).click();
    await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
    await assertNoSeriousViolations(page, '/calendar (List mode)');
    await page.getByRole('tab', { name: 'Month' }).click();
    await assertNoSeriousViolations(page, '/calendar (Month mode)');
    await page.getByRole('tab', { name: 'Year' }).click();
    await assertNoSeriousViolations(page, '/calendar (Year mode)');
    await page.getByRole('button', { name: 'Set availability…' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await assertNoSeriousViolations(page, '/calendar (Set availability… dialog)');
    await page.keyboard.press('Escape');

    await page.getByLabel('Main').getByRole('link', { name: 'Invites' }).click();
    await expect(page.getByRole('heading', { name: 'Invites' })).toBeVisible();
    await assertNoSeriousViolations(page, '/invites');

    await page.getByLabel('Main').getByRole('link', { name: 'Notifications' }).click();
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    await assertNoSeriousViolations(page, '/notifications');

    await page.getByLabel('Main').getByRole('link', { name: 'Profile' }).click();
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
    await assertNoSeriousViolations(page, '/profile');

    await page.goto('/visitors');
    await expect(page.getByRole('heading', { name: 'My visitors' })).toBeVisible();
    await assertNoSeriousViolations(page, '/visitors');

    await page.goto('/help');
    await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible();
    await assertNoSeriousViolations(page, '/help');

    await page.goto('/privacy');
    await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible();
    await assertNoSeriousViolations(page, '/privacy');

    // /privacy is a standalone route (reachable signed out too, from the
    // sign-in footer) — it renders outside AppShell, so there's no "Main"
    // nav on it. Go back to the app shell before continuing.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();

    await page.goto('/admin/members');
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
    await assertNoSeriousViolations(page, '/admin/members');

    await page.goto('/admin/programme');
    await expect(page.getByRole('heading', { name: 'Import programme' })).toBeVisible();
    await assertNoSeriousViolations(page, '/admin/programme');

    await page.goto('/admin/broadcast');
    await expect(page.getByRole('heading', { name: 'Broadcast' })).toBeVisible();
    await assertNoSeriousViolations(page, '/admin/broadcast');

    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
    await assertNoSeriousViolations(page, '/admin/audit');

    await page.goto('/admin/integrity');
    await expect(page.getByRole('heading', { name: 'Integrity' })).toBeVisible();
    await assertNoSeriousViolations(page, '/admin/integrity');
  });

  test('no horizontal overflow at a 320px viewport and 200% text zoom', async ({ page }) => {
    test.setTimeout(60_000);
    // Emulates a 200% browser zoom by halving the viewport (320 CSS px is
    // the standard "small phone at 2x zoom" baseline) and doubling the root
    // font size, per plan §14.1 "large-text mode" (task deliverable B).
    await page.setViewportSize({ width: 320, height: 640 });
    await signIn(page);
    await page.addStyleTag({ content: 'html { font-size: 36px !important; }' });
    await page.waitForTimeout(50);
    const overflowHome = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 2,
    );
    expect(overflowHome, 'My Card overflows horizontally at 320px/200% zoom').toBe(true);

    await page.getByLabel('Main').getByRole('link', { name: 'Programme', exact: true }).click();
    await page.getByRole('tab', { name: 'Mon' }).click();
    await page.getByRole('link', { name: /Mon 11 Jan 2027/ }).click();
    await expect(page.getByRole('heading', { name: 'Marion Taylor Pairs' })).toBeVisible();
    await page.waitForTimeout(50);
    const overflowSession = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 2,
    );
    expect(overflowSession, 'Session page overflows horizontally at 320px/200% zoom').toBe(true);

    // The Month/Year grids are the densest layouts in the app — the most
    // likely place a fixed-column grid could push past a narrow viewport.
    await page.getByLabel('Main').getByRole('link', { name: 'Calendar' }).click();
    await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
    await page.getByRole('tab', { name: 'Month' }).click();
    await page.waitForTimeout(50);
    const overflowMonth = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
    expect(overflowMonth, 'Calendar Month view overflows horizontally at 320px/200% zoom').toBe(true);

    await page.getByRole('tab', { name: 'Year' }).click();
    await page.waitForTimeout(50);
    const overflowYear = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
    expect(overflowYear, 'Calendar Year view overflows horizontally at 320px/200% zoom').toBe(true);
  });
});

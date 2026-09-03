/**
 * E2E: the Calendar screen (plan §21 B4) and the "Set availability…" bulk
 * action (plan §21 B2). Signs in as `david.hall@example.org` — a seeded
 * ordinary member no other spec signs in (see the seed's member list,
 * `firebase/seed/seed.ts`'s `FIRST_NAMES`/`LAST_NAMES`; every other member
 * used by `admin.spec.ts`/`dancecard.spec.ts`/`teams.spec.ts`/
 * `visitors.spec.ts` is a different name) — so this spec never shares
 * `requestLoginCode`'s per-email rate-limit budget with those specs, and its
 * bulk-availability writes never touch another spec's own entries (the bulk
 * action only ever creates/changes *the acting member's own* entries).
 *
 * Walks: opens Calendar (default List mode) and checks the seed's
 * current-year `Spring Pairs` session (the nearest upcoming Monday, plan
 * §21 B3's "second programme") appears with an `Open` status -> runs "Set
 * availability…" for Mondays, `Unavailable`, with `toDate` capped to the
 * **end of the current NZ year** (critical: this must never reach into the
 * seed's fixed, always-future 2027 programme that `programme.spec.ts` /
 * `dancecard.spec.ts` / `teams.spec.ts` / `visitors.spec.ts` /
 * `a11y.spec.ts` depend on) -> the session page for that Monday shows the
 * unavailable state -> runs "Set availability…" again with `Clear` (same
 * filter) -> the unavailable state is gone, leaving the seed clean for
 * reruns and other specs.
 *
 * Requires the emulators + seed + dev server already running (see
 * `web/README.md`). Every date-dependent value is computed from the same NZ
 * date math the seed uses (`@obc/shared`'s `todayNZ`/`addDaysNZ`/
 * `weekdayOfNZ`), not hardcoded, so this spec keeps working on whatever real
 * date it runs — including a second, back-to-back run with no re-seed.
 */
import type { Page } from '@playwright/test';
import { addDaysNZ, todayNZ, weekdayOfNZ } from '@obc/shared';
import { expect, test } from './support/fixtures';
import { waitForLoginCode } from './support/emailOutbox';

const MEMBER_EMAIL = 'david.hall@example.org';
const FIXED_YEAR = 2027; // the seed's other, always-future programme year

function isMondayNZ(date: string): boolean {
  try {
    return weekdayOfNZ(date) === 'monday';
  } catch {
    return false;
  }
}

/** Nearest-first Mondays walking from `addDaysNZ(from, direction)` — mirrors `seed.ts`'s `walkMondays`. */
function walkMondays(from: string, direction: 1 | -1, count: number): string[] {
  const found: string[] = [];
  let date = from;
  for (let i = 0; i < count * 7 + 7 && found.length < count; i++) {
    date = addDaysNZ(date, direction);
    if (isMondayNZ(date)) found.push(date);
  }
  return found;
}

const currentYear = Number(todayNZ().slice(0, 4));

test.skip(
  currentYear === FIXED_YEAR,
  `The seed skips its second (current-year) programme when the current NZ year is ${FIXED_YEAR} — nothing to test.`,
);

async function signIn(page: Page): Promise<void> {
  await page.goto('/signin');
  await page.getByLabel('Email address').fill(MEMBER_EMAIL);
  const sentAt = new Date();
  await page.getByRole('button', { name: 'Email me a code' }).click();
  const code = await waitForLoginCode(MEMBER_EMAIL, sentAt);
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible({ timeout: 15_000 });
}

test('Calendar overview + bulk "Set availability…" unavailable/clear round-trip', async ({ page }) => {
  test.setTimeout(60_000);

  const today = todayNZ();
  const futureMondays = walkMondays(today, 1, 2).filter((d) => d.startsWith(`${currentYear}-`));
  test.skip(futureMondays.length === 0, 'Year-boundary edge: the seed had no in-year future Monday to seed.');
  const nextMonday = futureMondays[0]!;
  const sessionPath = `/session/${currentYear}/monday-spring-pairs-${nextMonday}`;
  const toDate = `${currentYear}-12-31`;

  await signIn(page);

  // ---- Calendar: List mode shows the seeded upcoming session, open ----
  await page.getByLabel('Main').getByRole('link', { name: 'Calendar' }).click();
  await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('link', { name: 'Spring Pairs' }).first()).toBeVisible();

  // ---- Set availability… -> Unavailable, Mondays, capped to end of this NZ year ----
  await page.getByRole('button', { name: 'Set availability…' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('radio', { name: /^Unavailable/ }).click();
  await page.getByRole('checkbox', { name: 'Monday' }).click();
  await page.locator('#bulk-to-date').fill(toDate);
  await expect(page.getByText(/This will mark about \d+ session/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText(/^Marked \d+ session/)).toBeVisible();

  // ---- The session page for that Monday shows the unavailable state ----
  await page.goto(sessionPath);
  await expect(page.getByRole('heading', { name: 'Spring Pairs' })).toBeVisible();
  await expect(page.getByText("You've marked yourself unavailable for this session.")).toBeVisible();
  await expect(page.getByRole('button', { name: "I'm available again" })).toBeVisible();

  // ---- Set availability… -> Clear, same filter -> the marker is gone ----
  await page.getByLabel('Main').getByRole('link', { name: 'Calendar' }).click();
  await page.getByRole('button', { name: 'Set availability…' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('radio', { name: /^Clear/ }).click();
  await page.getByRole('checkbox', { name: 'Monday' }).click();
  await page.locator('#bulk-to-date').fill(toDate);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText(/^Marked \d+ session/)).toBeVisible();

  await page.goto(sessionPath);
  await expect(page.getByRole('heading', { name: 'Spring Pairs' })).toBeVisible();
  await expect(page.getByText("You've marked yourself unavailable for this session.")).toHaveCount(0);
  await expect(page.getByRole('button', { name: "I'm looking for a partner" })).toBeVisible();
});

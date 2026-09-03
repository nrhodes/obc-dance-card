/**
 * E2E: plan §21 B3 ("Hide past events by default + two-year horizon").
 *
 * The seed (`firebase/seed/seed.ts`) publishes two programme years: the fixed
 * 2027 programme (always in the future relative to a real clock — useful for
 * every *other* spec, but it can never exercise "hide past events by
 * default", since none of its sessions are ever past) and a second programme
 * keyed to the current NZ year, with two standalone "Casual Monday Bridge"
 * sessions on the two most recent past Mondays and a `Spring Pairs` series
 * running the next two upcoming Mondays. See `firebase/seed/README.md` for
 * the full rationale (including why the past sessions are standalone rather
 * than more `Spring Pairs` dates: a series with any future session stays
 * fully visible, so folding all four dates into one series would leave
 * nothing for "Show earlier sessions" to actually hide).
 *
 * This spec walks the Monday tab of the Programme screen and checks:
 * - the heading spans both loaded published years;
 * - a seeded past session is hidden by default, and revealed by the
 *   "Show earlier sessions" toggle;
 * - a next-Monday (current-year) session link navigates to a working
 *   session page — proving cross-year navigation (`/session/:year/:id`)
 *   works for a year other than the fixed 2027 one.
 *
 * Every date-dependent assertion is computed from the same NZ date math the
 * seed uses (`@obc/shared`'s `todayNZ`/`addDaysNZ`/`weekdayOfNZ`), not
 * hardcoded, so this spec keeps working on whatever real date it runs.
 *
 * Requires the emulators + seed + dev server already running (see
 * `web/README.md`), and is read-only (never signs anyone up), so it's safe
 * to run in any batch, any number of times, without a fresh seed.
 */
import { addDaysNZ, todayNZ, weekdayOfNZ } from '@obc/shared';
import { expect, test } from './support/fixtures';
import { waitForLoginCode } from './support/emailOutbox';

const ADMIN_EMAIL = 'admin@example.org';
const FIXED_YEAR = 2027; // the seed's other, always-future programme year

/** True when `date` (`YYYY-MM-DD`) falls on a Monday (NZ). */
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

/** Mirrors `web/src/lib/format.ts#formatDateNZ` — "Mon 31 Aug 2026" — independently, without importing app source. */
const nzDateLabelFormatter = new Intl.DateTimeFormat('en-NZ', {
  timeZone: 'Pacific/Auckland',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
function formatDateNZLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const instant = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  const parts = nzDateLabelFormatter.formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')} ${get('year')}`;
}

const currentYear = Number(todayNZ().slice(0, 4));

test.skip(
  currentYear === FIXED_YEAR,
  `The seed skips its second programme when the current NZ year is ${FIXED_YEAR} (same as the fixed one) — nothing to test.`,
);

test('past-hiding default + two-year horizon on the Programme screen', async ({ page }) => {
  test.setTimeout(60_000);

  const today = todayNZ();
  const pastMondays = walkMondays(today, -1, 2).filter((d) => d.startsWith(`${currentYear}-`)).sort();
  const futureMondays = walkMondays(today, 1, 2).filter((d) => d.startsWith(`${currentYear}-`)).sort();
  test.skip(pastMondays.length === 0 || futureMondays.length === 0, 'Year-boundary edge: the seed had no in-year Monday to seed.');

  const mostRecentPastMonday = pastMondays[pastMondays.length - 1]!;
  const nextMonday = futureMondays[0]!;

  await page.goto('/signin');
  await page.getByLabel('Email address').fill(ADMIN_EMAIL);
  const sentAt = new Date();
  await page.getByRole('button', { name: 'Email me a code' }).click();
  const code = await waitForLoginCode(ADMIN_EMAIL, sentAt);
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible({ timeout: 15_000 });

  await page.getByLabel('Main').getByRole('link', { name: 'Programme', exact: true }).click();

  // Heading spans both loaded published years (plan §21 B3).
  const [olderYear, newerYear] = [currentYear, FIXED_YEAR].sort((a, b) => a - b);
  await expect(page.getByRole('heading', { name: `${olderYear} & ${newerYear} Programme` })).toBeVisible();

  await page.getByRole('tab', { name: 'Mon' }).click();
  await expect(page.getByRole('tab', { name: 'Mon' })).toHaveAttribute('aria-selected', 'true');

  // `Spring Pairs` (the current year's series) runs only future Mondays, so it's always visible.
  await expect(page.getByText('Spring Pairs')).toBeVisible();
  const nextMondayLink = page.getByRole('link', { name: new RegExp(formatDateNZLabel(nextMonday)) });
  await expect(nextMondayLink).toBeVisible();

  // The most recent past Monday's standalone "Casual Monday Bridge" session is hidden by default...
  const pastLinkPattern = new RegExp(`${formatDateNZLabel(mostRecentPastMonday)}.*Casual Monday Bridge`);
  await expect(page.getByText(pastLinkPattern)).toBeHidden();

  // ...and appears after "Show earlier sessions".
  await page.getByRole('button', { name: 'Show earlier sessions' }).click();
  await expect(page.getByText(pastLinkPattern)).toBeVisible();

  // ...and hides again after "Hide earlier sessions" (round-trip).
  await page.getByRole('button', { name: 'Hide earlier sessions' }).click();
  await expect(page.getByText(pastLinkPattern)).toBeHidden();

  // A next-Monday (current-year) session link navigates to a working session page —
  // proving cross-year navigation (`/session/:year/:sessionId`) beyond the fixed 2027 year.
  await nextMondayLink.click();
  await expect(page).toHaveURL(new RegExp(`/session/${currentYear}/monday-spring-pairs-${nextMonday}$`));
  await expect(page.getByRole('heading', { name: 'Spring Pairs' })).toBeVisible();
  await expect(page.getByText('Nobody has signed up yet.')).toBeVisible();
});

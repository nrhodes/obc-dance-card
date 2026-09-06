/**
 * Profile, Help, and Sign out live behind a "More" disclosure in the main
 * nav (2026-09-06 UI review: de-densifying the flat member nav and folding
 * in the header's old standalone "Not you? Sign out" link — see
 * `AppShell.tsx`). It's the same pattern as the Admin disclosure
 * (`admin.spec.ts`'s `openAdmin`): closes on navigation, so open it fresh
 * before each click. Scoped to `.more-menu-list` because "Sign out" also
 * appears on the Profile screen, and "Profile"/"Help" could in principle
 * collide with other page content.
 */
import type { Locator, Page } from '@playwright/test';

export async function openMore(page: Page): Promise<Locator> {
  await page.getByLabel('Main').getByRole('button', { name: /More/ }).click();
  return page.locator('.more-menu-list');
}

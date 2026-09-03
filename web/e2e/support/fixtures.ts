/**
 * Playwright test fixture that wipes the emulator's auth-throttling state
 * before every test (see `reset.ts`). Importing `test`/`expect` from here
 * instead of `@playwright/test` guarantees each test's sign-ins start from a
 * clean rate-limit slate, which is the main historical source of E2E
 * flakiness. Specs otherwise use `test`/`expect` exactly as before.
 */
import { test as base, expect } from '@playwright/test';
import { resetAuthThrottle } from './reset';

export const test = base.extend<{ freshAuthThrottle: void }>({
  freshAuthThrottle: [
    async ({}, use) => {
      await resetAuthThrottle();
      await use();
    },
    { auto: true },
  ],
});

export { expect };

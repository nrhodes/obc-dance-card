import { defineConfig, devices } from '@playwright/test';

/**
 * Assumes the emulators + seed are already running and `npm run dev -w web`
 * is serving the app — see `web/README.md`. Deliberately does NOT start
 * either itself: the seed data (and the functions emulator's printed login
 * codes) need to exist before the suite runs, and re-seeding on every run
 * would be slow and noisy.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.WEB_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

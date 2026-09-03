import { defineConfig, devices } from '@playwright/test';

/**
 * The emulators must already be running and seeded before the suite starts
 * (they carry the programme + members + the functions emulator that prints
 * login codes) — see `web/README.md` / the CI `e2e-test` job. Playwright
 * itself owns only the Vite dev server (via `webServer`), so a run is one
 * command once the emulators are up.
 *
 * Robustness: the auth-throttle reset fixture (support/fixtures.ts) removes the
 * login-code rate limit as a flake source; on CI we also retry twice and keep
 * a trace on the first retry. Specs run serially (workers: 1) so the two-context
 * specs don't contend for the shared emulator.
 */
const PORT = Number(process.env.WEB_E2E_PORT ?? 5173);
const BASE_URL = process.env.WEB_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },
  webServer: {
    command: `npm run dev -w web -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    cwd: '..',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

// `defineConfig` comes from `vitest/config`, not `vite`: the `test` block
// below is Vitest's, and Vite's own `UserConfigExport` type has no `test`
// key — importing from 'vite' fails the build under Vitest 3+.
import { defineConfig } from 'vitest/config';
import { execFileSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// PWA precaching MUST NOT touch anything that talks to Firebase (plan §8.1,
// §14.1: shared devices, no caching of Firestore/Functions responses). We
// precache the built app shell only.
//
// Phase 5b (web push) needs a service worker that can also receive FCM
// background messages (`onBackgroundMessage`, `notificationclick`) — and a
// page may only ever be controlled by ONE active service worker per scope.
// Rather than register a second worker alongside the Workbox one (which
// would race the app-shell worker for control of the page and make the
// "does push still work offline-cached" story unclear), this project builds
// a single worker from its own TypeScript source (`src/push/sw.ts`) via
// vite-plugin-pwa's `injectManifest` strategy: our source calls
// `precacheAndRoute(self.__WB_MANIFEST)` itself (replacing the
// `workbox: {...}` config generateSW used to consume) *and* sets up FCM. See
// `src/push/sw.ts` and `docs/web-push.md` for the full rationale.
//
// `filename: 'sw.ts'` (relative to `srcDir`) becomes `dist/sw.js` — a single
// file at the site root, scope `/`. The app never relies on FCM's default
// `/firebase-messaging-sw.js` path lookup (it passes `serviceWorkerRegistration`
// explicitly to `getToken`, per `src/push/usePush.ts`), so the merged
// worker's filename is free to describe what it now actually is: the app's
// one and only service worker, not "the FCM one".
/**
 * The commit this bundle is built from, baked into the JavaScript so the app
 * can say which version is actually RUNNING in this tab (Help screen). That
 * can differ from `/version.json` — the version currently deployed — for as
 * long as an older bundle is still loaded or cached. Same resolution order
 * as `scripts/write-version.mjs`; never a build failure.
 */
function resolveCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return process.env.GITHUB_SHA || 'unknown';
  }
}

export default defineConfig({
  define: {
    __APP_COMMIT__: JSON.stringify(resolveCommit()),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt' + injectRegister: false (Phase 7b task deliverable D): a
      // member mid-invite should never have the page swapped out from under
      // them by a silent auto-update. `src/pwa/usePwaUpdate.ts` calls
      // `registerSW` itself and shows "A new version is ready — Reload" from
      // `AppShell` when `onNeedRefresh` fires, instead of the plugin's
      // default injected script auto-registering with no user-visible
      // control over *when* the new version takes over.
      registerType: 'prompt',
      injectRegister: false,
      strategies: 'injectManifest',
      srcDir: 'src/push',
      filename: 'sw.ts',
      injectManifest: {
        // Precache the built app shell (HTML/JS/CSS/icons) only — same
        // globs as the old generateSW config. No `runtimeCaching`-style
        // option exists for injectManifest: because `sw.ts` never imports
        // `workbox-strategies` or calls `registerRoute` for anything other
        // than the same-origin SPA-shell fallback, nothing dynamic
        // (Firestore, callables, auth, or anything on *.googleapis.com /
        // *.cloudfunctions.net / *.run.app) is EVER written to a Workbox
        // cache — there is simply no route registered that could catch it.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
      },
      manifest: {
        // The product's name, not a club's (`PRODUCT_NAME` /
        // `PRODUCT_SHORT_NAME`, shared/src/brand.ts — `brand.test.ts` keeps
        // these in step): one install serves every club a person is in.
        name: 'Bridge Programme',
        short_name: 'Programme',
        description: "Your bridge club's programme and partners",
        theme_color: '#1b3a57',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    css: false,
    // Playwright owns e2e/**; vitest must never try to collect it as a spec file.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
});

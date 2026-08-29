/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
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
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
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
        name: 'Orewa Bridge Club Dance Card',
        short_name: 'Dance Card',
        description: "Orewa Bridge Club's electronic dance card",
        theme_color: '#1b3a57',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [],
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

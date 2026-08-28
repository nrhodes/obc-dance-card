/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// PWA precaching MUST NOT touch anything that talks to Firebase (plan §8.1,
// §14.1: shared devices, no caching of Firestore/Functions responses). We
// precache the built app shell only, and explicitly deny navigation fallback
// and runtime caching for every Google/Firebase-hosted origin and the local
// emulator ports so a stale cached response can never stand in for a live
// call.
const NEVER_CACHE = [
  /^https:\/\/[^/]*\.googleapis\.com\//,
  /^https:\/\/[^/]*\.cloudfunctions\.net\//,
  /^https:\/\/[^/]*\.run\.app\//,
  /^http:\/\/127\.0\.0\.1:(9099|8080|5001|4000|5000|8085)\//,
  /^http:\/\/localhost:(9099|8080|5001|4000|5000|8085)\//,
];

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        // Precache the built app shell (HTML/JS/CSS/icons) only.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: NEVER_CACHE,
        // No runtime caching entries at all: nothing dynamic (Firestore,
        // callables, auth) is ever written to the Workbox cache.
        runtimeCaching: [],
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

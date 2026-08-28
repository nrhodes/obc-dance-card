import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Emulator-backed tests run separately via `npm run test:emu` (needs the
    // Firestore + Auth emulators up); keep them out of the plain unit suite.
    exclude: ['src/**/*.emu.test.ts', '**/node_modules/**'],
    environment: 'node',
  },
});

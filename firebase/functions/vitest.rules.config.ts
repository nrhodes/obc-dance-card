import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['rules-test/**/*.test.ts'],
    environment: 'node',
    // Rules tests share one emulator; run them serially.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});

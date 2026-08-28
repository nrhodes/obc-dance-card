import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.emu.test.ts'],
    environment: 'node',
    // Every test in this suite shares one Firestore/Auth emulator pair.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

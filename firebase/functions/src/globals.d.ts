/**
 * Build-time constants injected by `scripts/bundle.mjs` (esbuild `define`).
 * Absent under vitest, tsx and the emulator — read them only through
 * `lib/build.ts`, which falls back to "unknown".
 */
declare const __OBC_BUILD_COMMIT__: string | undefined;
declare const __OBC_BUILD_AT__: string | undefined;

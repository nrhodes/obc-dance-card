import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `ENFORCE_APP_CHECK` App Check param (plan §8.3, §18, phase 7a). Verifies:
 *  - it defaults to `false` when `ENFORCE_APP_CHECK` is unset (emulator/tests);
 *  - it reflects `ENFORCE_APP_CHECK=true` at module load (production);
 *  - `consumeAppCheckToken` is explicitly `false` regardless.
 * The module reads the param once at import time (see `callable.ts`), so
 * each case re-imports it fresh via `vi.resetModules()`.
 */
describe('callableOptions — App Check param', () => {
  const originalValue = process.env.ENFORCE_APP_CHECK;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.ENFORCE_APP_CHECK;
    } else {
      process.env.ENFORCE_APP_CHECK = originalValue;
    }
    vi.resetModules();
  });

  it('defaults enforceAppCheck to false when the env var is unset', async () => {
    delete process.env.ENFORCE_APP_CHECK;
    const { callableOptions } = await import('./callable.js');
    expect(callableOptions.enforceAppCheck).toBe(false);
  });

  it('is true when ENFORCE_APP_CHECK=true at module load (production posture)', async () => {
    process.env.ENFORCE_APP_CHECK = 'true';
    const { callableOptions } = await import('./callable.js');
    expect(callableOptions.enforceAppCheck).toBe(true);
  });

  it('treats any non-"true" value as false', async () => {
    process.env.ENFORCE_APP_CHECK = 'yes';
    const { callableOptions } = await import('./callable.js');
    expect(callableOptions.enforceAppCheck).toBe(false);
  });

  it('always disables consumeAppCheckToken (plan §8.3)', async () => {
    delete process.env.ENFORCE_APP_CHECK;
    const { callableOptions } = await import('./callable.js');
    expect(callableOptions.consumeAppCheckToken).toBe(false);
  });

  it('pins the region/instance/timeout/memory hardening defaults', async () => {
    const { callableOptions } = await import('./callable.js');
    expect(callableOptions.region).toBe('australia-southeast1');
    expect(callableOptions.maxInstances).toBe(5);
    expect(callableOptions.timeoutSeconds).toBe(60);
    expect(callableOptions.memory).toBe('256MiB');
  });
});

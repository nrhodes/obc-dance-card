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

  it('defaults enforceAppCheck to TRUE when the env var is unset (security review M3)', async () => {
    delete process.env.ENFORCE_APP_CHECK;
    const { callableOptions } = await import('./callable.js');
    expect(callableOptions.enforceAppCheck).toBe(true);
  });

  it('is false only for the literal "false" (the committed emulator setting)', async () => {
    process.env.ENFORCE_APP_CHECK = 'false';
    const { callableOptions } = await import('./callable.js');
    expect(callableOptions.enforceAppCheck).toBe(false);
  });

  it('is true when ENFORCE_APP_CHECK=true at module load (production posture)', async () => {
    process.env.ENFORCE_APP_CHECK = 'true';
    const { callableOptions } = await import('./callable.js');
    expect(callableOptions.enforceAppCheck).toBe(true);
  });

  it('fails closed: a typo or any other value still enforces', async () => {
    process.env.ENFORCE_APP_CHECK = 'yes';
    const { callableOptions } = await import('./callable.js');
    expect(callableOptions.enforceAppCheck).toBe(true);
  });

  describe('on a deployed instance', () => {
    const originalService = process.env.K_SERVICE;
    const originalEmulator = process.env.FUNCTIONS_EMULATOR;
    afterEach(() => {
      if (originalService === undefined) delete process.env.K_SERVICE;
      else process.env.K_SERVICE = originalService;
      if (originalEmulator === undefined) delete process.env.FUNCTIONS_EMULATOR;
      else process.env.FUNCTIONS_EMULATOR = originalEmulator;
    });

    it('refuses to load with ENFORCE_APP_CHECK=false, so a misconfigured deploy fails its rollout', async () => {
      process.env.K_SERVICE = 'requestlogincode';
      delete process.env.FUNCTIONS_EMULATOR;
      process.env.ENFORCE_APP_CHECK = 'false';
      await expect(import('./callable.js')).rejects.toThrow(/Refusing to start/);
    });

    it('loads normally when enforced', async () => {
      process.env.K_SERVICE = 'requestlogincode';
      delete process.env.FUNCTIONS_EMULATOR;
      delete process.env.ENFORCE_APP_CHECK;
      const { callableOptions } = await import('./callable.js');
      expect(callableOptions.enforceAppCheck).toBe(true);
    });

    it('the emulator (K_SERVICE + FUNCTIONS_EMULATOR) may run unenforced', async () => {
      process.env.K_SERVICE = 'requestlogincode';
      process.env.FUNCTIONS_EMULATOR = 'true';
      process.env.ENFORCE_APP_CHECK = 'false';
      const { callableOptions } = await import('./callable.js');
      expect(callableOptions.enforceAppCheck).toBe(false);
    });
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

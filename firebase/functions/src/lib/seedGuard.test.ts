import { describe, expect, it } from 'vitest';
import { checkEmulatorSafe } from './seedGuard.js';

const BOTH_HOSTS = {
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
};

describe('checkEmulatorSafe (seed script guard, plan §3 rule 10)', () => {
  it('throws when both emulator hosts are unset', () => {
    expect(() => checkEmulatorSafe({}, [])).toThrow(/FIRESTORE_EMULATOR_HOST/);
  });

  it('throws when only one emulator host is set', () => {
    expect(() =>
      checkEmulatorSafe({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, []),
    ).toThrow(/FIRESTORE_EMULATOR_HOST/);
  });

  it('throws for the real production project id even with both hosts set', () => {
    expect(() =>
      checkEmulatorSafe({ ...BOTH_HOSTS, GCLOUD_PROJECT: 'obc-dance-card' }, []),
    ).toThrow(/demo-/);
  });

  it('throws for a missing project id', () => {
    expect(() => checkEmulatorSafe(BOTH_HOSTS, [])).toThrow(/none/);
  });

  it('accepts a demo-* project from GCLOUD_PROJECT and returns it', () => {
    expect(checkEmulatorSafe({ ...BOTH_HOSTS, GCLOUD_PROJECT: 'demo-obc' }, [])).toBe('demo-obc');
  });

  it('accepts a demo-* project from --project and prefers it over env vars', () => {
    expect(
      checkEmulatorSafe(
        { ...BOTH_HOSTS, GCLOUD_PROJECT: 'obc-dance-card' },
        ['node', 'seed.ts', '--project', 'demo-other'],
      ),
    ).toBe('demo-other');
  });
});

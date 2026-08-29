import { describe, expect, it } from 'vitest';
import {
  IDLE_SIGN_OUT_MS,
  LAST_ACTIVITY_STORAGE_KEY,
  isIdleExpired,
  readLastActivity,
  writeLastActivity,
} from './idleSignOut';

function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    raw: store,
  };
}

describe('isIdleExpired', () => {
  it('is false when nothing has ever been recorded', () => {
    expect(isIdleExpired(null, Date.now())).toBe(false);
  });

  it('is false exactly at the 30-day boundary', () => {
    const now = 1_000_000_000_000;
    expect(isIdleExpired(now - IDLE_SIGN_OUT_MS, now)).toBe(false);
  });

  it('is true just past 30 days idle', () => {
    const now = 1_000_000_000_000;
    expect(isIdleExpired(now - IDLE_SIGN_OUT_MS - 1, now)).toBe(true);
  });

  it('is false for recent activity', () => {
    const now = 1_000_000_000_000;
    expect(isIdleExpired(now - 1000, now)).toBe(false);
  });
});

describe('readLastActivity / writeLastActivity', () => {
  it('round-trips a written timestamp', () => {
    const storage = memoryStorage();
    writeLastActivity(storage, 12345);
    expect(readLastActivity(storage)).toBe(12345);
    expect(storage.raw.get(LAST_ACTIVITY_STORAGE_KEY)).toBe('12345');
  });

  it('returns null when nothing is stored', () => {
    expect(readLastActivity(memoryStorage())).toBeNull();
  });

  it('returns null for a corrupted (non-numeric) value', () => {
    const storage = memoryStorage({ [LAST_ACTIVITY_STORAGE_KEY]: 'not-a-number' });
    expect(readLastActivity(storage)).toBeNull();
  });

  it('readLastActivity swallows a throwing storage', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readLastActivity(storage)).toBeNull();
  });

  it('writeLastActivity swallows a throwing storage', () => {
    const storage = {
      setItem: () => {
        throw new Error('quota exceeded');
      },
    };
    expect(() => writeLastActivity(storage, Date.now())).not.toThrow();
  });
});

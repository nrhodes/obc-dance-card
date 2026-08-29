import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_SIGN_OUT_MS, LAST_ACTIVITY_STORAGE_KEY } from './idleSignOut';
import { useIdleSignOut } from './useIdleSignOut';

function stubLocalStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  });
  return store;
}

beforeEach(() => {
  stubLocalStorage();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useIdleSignOut', () => {
  it('signs out immediately when the recorded activity is more than 30 days old', () => {
    const store = stubLocalStorage();
    store.set(LAST_ACTIVITY_STORAGE_KEY, String(Date.now() - IDLE_SIGN_OUT_MS - 1));
    const signOut = vi.fn();

    renderHook(() => useIdleSignOut(signOut));

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('does not sign out and records activity when recent activity exists', () => {
    const store = stubLocalStorage();
    store.set(LAST_ACTIVITY_STORAGE_KEY, String(Date.now() - 1000));
    const signOut = vi.fn();

    renderHook(() => useIdleSignOut(signOut));

    expect(signOut).not.toHaveBeenCalled();
    expect(store.get(LAST_ACTIVITY_STORAGE_KEY)).toBeDefined();
  });

  it('does not sign out on a brand-new device with nothing recorded yet', () => {
    const signOut = vi.fn();
    renderHook(() => useIdleSignOut(signOut));
    expect(signOut).not.toHaveBeenCalled();
  });

  it('records activity on a pointerdown event, throttled to once a minute', () => {
    vi.useFakeTimers();
    const store = stubLocalStorage();
    const signOut = vi.fn();
    renderHook(() => useIdleSignOut(signOut));
    store.delete(LAST_ACTIVITY_STORAGE_KEY);

    // Immediately after mount: throttled, so this one is dropped.
    window.dispatchEvent(new Event('pointerdown'));
    expect(store.get(LAST_ACTIVITY_STORAGE_KEY)).toBeUndefined();

    // Past the one-minute throttle window: recorded.
    vi.advanceTimersByTime(61_000);
    window.dispatchEvent(new Event('pointerdown'));
    expect(store.get(LAST_ACTIVITY_STORAGE_KEY)).toBeDefined();
  });
});

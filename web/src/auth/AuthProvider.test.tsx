import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { AuthProvider } from './AuthProvider';
import { IDLE_SIGN_OUT_MS, LAST_ACTIVITY_STORAGE_KEY } from '../session/idleSignOut';

let authCallback: ((u: User | null) => void) | null = null;

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (u: User | null) => void) => {
    authCallback = cb;
    return () => undefined;
  },
  signOut: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  onSnapshot: () => () => undefined,
}));
vi.mock('../firebase', () => ({ auth: {}, db: {}, appCheckWorking: async () => true }));

function stubLocalStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  return store;
}

const user = { uid: 'u1' } as User;

afterEach(() => {
  authCallback = null;
});

describe('AuthProvider: a sign-in made in this page counts as activity (incident 2026-11-17)', () => {
  it('stamps last activity on a null -> user transition, overwriting a 30-day-old stamp', () => {
    const store = stubLocalStorage();
    const stale = Date.now() - IDLE_SIGN_OUT_MS - 60_000;
    store.set(LAST_ACTIVITY_STORAGE_KEY, String(stale));
    render(<AuthProvider><span /></AuthProvider>);
    authCallback!(null); // initial restored state: signed out
    authCallback!(user); // the member signs in
    expect(Number(store.get(LAST_ACTIVITY_STORAGE_KEY))).toBeGreaterThan(stale);
  });

  it('does not stamp a session merely restored from persistence (the idle rule must still apply to it)', () => {
    const store = stubLocalStorage();
    const stale = Date.now() - IDLE_SIGN_OUT_MS - 60_000;
    store.set(LAST_ACTIVITY_STORAGE_KEY, String(stale));
    render(<AuthProvider><span /></AuthProvider>);
    authCallback!(user); // first state already signed in: restored, not fresh
    expect(store.get(LAST_ACTIVITY_STORAGE_KEY)).toBe(String(stale));
  });
});

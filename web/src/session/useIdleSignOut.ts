/**
 * Wires `idleSignOut.ts`'s pure logic to real `localStorage` and DOM
 * activity events (plan §8.1 shared devices; Phase 7b task deliverable C).
 * Mounted once from `AppShell` (i.e. only while a member is signed in).
 *
 * On mount: if the last recorded activity was more than 30 days ago, signs
 * out immediately ("on next load", per the task brief). Otherwise, records
 * activity now and on every subsequent pointer/keyboard interaction or tab
 * becoming visible again — throttled to at most once a minute so this never
 * spams `localStorage` on every keystroke.
 */
import { useEffect, useRef } from 'react';
import { isIdleExpired, readLastActivity, writeLastActivity } from './idleSignOut';

const THROTTLE_MS = 60_000;

export function useIdleSignOut(signOut: () => void | Promise<void>): void {
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;

    const last = readLastActivity(localStorage);
    if (isIdleExpired(last, Date.now())) {
      void signOutRef.current();
      return;
    }
    writeLastActivity(localStorage, Date.now());

    let lastWrite = Date.now();
    function recordActivity() {
      const now = Date.now();
      if (now - lastWrite < THROTTLE_MS) return;
      lastWrite = now;
      writeLastActivity(localStorage, now);
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') recordActivity();
    }

    window.addEventListener('pointerdown', recordActivity);
    window.addEventListener('keydown', recordActivity);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pointerdown', recordActivity);
      window.removeEventListener('keydown', recordActivity);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
}

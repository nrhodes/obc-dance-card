/**
 * Keeps every visitor on the current build.
 *
 * Until 2026-11-17 the service worker was registered (and a waiting update
 * surfaced) only inside the signed-in `AppShell`, via `usePwaUpdate`. A
 * member who could not get past the sign-in screen therefore never received
 * an update: the old worker kept serving its precached shell and bundle,
 * indefinitely — "the problem was saved info in the browser", again.
 *
 * Mounted at the app root, this registers the worker on every screen and
 * applies a waiting update at once whenever nobody is signed in (nothing on
 * those screens can be lost by a reload). Signed-in members still get the
 * banner in `AppShell` and choose when to reload (plan: registerType
 * 'prompt'). Renders nothing.
 */
import { useEffect } from 'react';
import { useAuth } from '../auth/useAuth';
import { usePwaUpdate } from './usePwaUpdate';

export function PwaUpdater() {
  const { status } = useAuth();
  const { needsRefresh, reload } = usePwaUpdate();
  const applyNow = needsRefresh && status !== 'signedIn' && status !== 'loading';

  useEffect(() => {
    if (applyNow) reload();
  }, [applyNow, reload]);

  return null;
}

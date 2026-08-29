/**
 * PWA update prompt (plan §14.1 PWA rules; Phase 7b task deliverable D).
 * `vite.config.ts` sets `registerType: 'prompt'` and `injectRegister: false`
 * specifically so update handling is ours to control here, instead of
 * Workbox silently skip-waiting-and-reloading on its own — a member
 * part-way through inviting a partner should never have the page swapped
 * out from under them without being asked.
 *
 * `registerSW` is called exactly once, at first use (a module-level guard,
 * not an effect that re-registers on every mount) — React StrictMode's dev
 * double-invoke would otherwise register the update-check twice — and its
 * `updateSW` callback and `needsRefresh` flag are shared by every component
 * that calls this hook (in practice, just `AppShell`, mounted once).
 */
import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
let needsRefresh = false;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function ensureRegistered(): void {
  if (updateSW) return;
  updateSW = registerSW({
    onNeedRefresh() {
      needsRefresh = true;
      notify();
    },
  });
}

export interface UsePwaUpdateResult {
  needsRefresh: boolean;
  reload: () => void;
}

export function usePwaUpdate(): UsePwaUpdateResult {
  const [, forceRender] = useState(0);

  useEffect(() => {
    ensureRegistered();
    const listener = () => forceRender((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return {
    needsRefresh,
    reload: () => {
      void updateSW?.(true);
    },
  };
}

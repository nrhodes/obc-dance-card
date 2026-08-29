/**
 * Foreground push-message toast (plan §16 Phase 5b / Phase 7b task
 * deliverable F). Mounted once, app-wide, from `AppShell` — not tied to any
 * one screen — so a push that arrives while the tab is open and visible
 * always shows the in-app toast (`role="status"`), on whichever page the
 * member happens to be on, instead of only while Profile was mounted (see
 * `docs/web-push.md`).
 *
 * A background push (the tab not focused, or the app not open at all) is
 * unaffected either way — `onBackgroundMessage` in `sw.ts` handles that
 * regardless of which screen, or whether the app, is open.
 */
import { useEffect, useState } from 'react';
import { onMessage } from 'firebase/messaging';
import { getMessagingIfSupported } from '../firebase';

export interface UsePushForegroundResult {
  toast: string | null;
  dismissToast: () => void;
}

export function usePushForeground(): UsePushForegroundResult {
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const messaging = await getMessagingIfSupported();
      if (!messaging || cancelled) return;
      unsubscribe = onMessage(messaging, (payload) => {
        const data = (payload.data ?? {}) as Record<string, string | undefined>;
        const body =
          payload.notification?.body ?? data.body ?? payload.notification?.title ?? data.title;
        if (body) setToast(body);
      });
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return { toast, dismissToast: () => setToast(null) };
}

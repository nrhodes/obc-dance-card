/**
 * Web push registration state machine (plan §16 Phase 5 / task brief B).
 *
 * States:
 *  - `unsupported` — this browser can't do web push (`isSupported()` false —
 *    most commonly iOS/iPadOS Safari not installed to the Home Screen).
 *  - `denied`      — the user (or a prior visit) denied the notification
 *    permission at the browser level; only the user can undo that, in their
 *    browser's site settings.
 *  - `prompt`      — supported, not denied, but not turned on for this
 *    device yet (or was turned off here). Nothing has been requested from
 *    the browser yet.
 *  - `enabled`      — a token for this device is registered.
 *  - `error`        — the last enable/disable attempt failed.
 *
 * Deliberately never calls `Notification.requestPermission()` on its own —
 * elderly users and browser heuristics both punish auto-prompting (plan
 * task brief B). The *only* place permission is requested is inside
 * `enable()`, which only ever runs from a direct button click in
 * `PushSettings`.
 *
 * On mount, if permission is already `granted` and a token from a previous
 * visit is in `localStorage`, this re-fetches the token (no prompt — calling
 * `getToken` when permission is already granted never prompts) purely to
 * detect **token rotation**: FCM occasionally rotates a device's token, and
 * the old one must be unregistered so `memberPrivate.devices` doesn't
 * accumulate dead entries.
 */
import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { deleteToken, getToken, onMessage } from 'firebase/messaging';
import { auth, getMessagingIfSupported, toAppError, type AppError } from '../firebase';
import { registerDevice, unregisterDevice } from './api';
import { browserDeviceLabel } from './deviceLabel';

export type PushState = 'unsupported' | 'denied' | 'prompt' | 'enabled' | 'error';

/** `localStorage` key for this device's last-known FCM token (task brief B). */
export const PUSH_TOKEN_STORAGE_KEY = 'obc.pushToken';

const IOS_UA = /iPad|iPhone|iPod/;

/**
 * `getToken`'s options, keyed the registration in explicitly and the VAPID
 * key only when set (`exactOptionalPropertyTypes` treats an explicit
 * `undefined` differently from an absent key — and a blank
 * `VITE_FIREBASE_VAPID_KEY`, e.g. in local dev against the emulator per
 * `.env.example`, is expected).
 */
function getTokenOptions(serviceWorkerRegistration: ServiceWorkerRegistration) {
  const vapidKey = (import.meta.env as Record<string, string | undefined>).VITE_FIREBASE_VAPID_KEY || undefined;
  return { serviceWorkerRegistration, ...(vapidKey ? { vapidKey } : {}) };
}

export interface UsePushResult {
  state: PushState;
  /** True while `enable`/`disable` is in flight — for disabling the button, not a distinct `state`. */
  busy: boolean;
  /** True when the UA looks like iOS/iPadOS — drives the Home Screen install hint under `unsupported`. */
  isIos: boolean;
  error: AppError | null;
  /** Latest foreground push body, for an in-app toast; `null` once dismissed. */
  toast: string | null;
  dismissToast: () => void;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
}

export function usePush(): UsePushResult {
  const [state, setState] = useState<PushState>('prompt');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Initial state detection — see module doc comment for the "detect
  // rotation silently" behaviour.
  useEffect(() => {
    void (async () => {
      const messaging = await getMessagingIfSupported();
      if (!messaging) {
        if (mounted.current) setState('unsupported');
        return;
      }
      if (typeof Notification === 'undefined') {
        if (mounted.current) setState('unsupported');
        return;
      }
      if (Notification.permission === 'denied') {
        if (mounted.current) setState('denied');
        return;
      }
      if (Notification.permission === 'default') {
        if (mounted.current) setState('prompt');
        return;
      }

      // permission === 'granted'
      const storedToken = localStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
      if (!storedToken) {
        if (mounted.current) setState('prompt');
        return;
      }
      try {
        const registration = await navigator.serviceWorker.ready;
        const token = await getToken(messaging, getTokenOptions(registration));
        if (token && token !== storedToken) {
          await registerDevice({ token, platform: 'web', label: browserDeviceLabel(navigator.userAgent) });
          await unregisterDevice({ token: storedToken }).catch(() => undefined);
          localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
        }
        if (mounted.current) setState('enabled');
      } catch {
        // A transient failure to refresh (e.g. offline) shouldn't demote an
        // already-enabled device back to "prompt".
        if (mounted.current) setState('enabled');
      }
    })();
  }, []);

  // Foreground messages: an in-app toast only, never an OS notification
  // while the tab is open (task brief B).
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      const messaging = await getMessagingIfSupported();
      if (!messaging || !mounted.current) return;
      unsubscribe = onMessage(messaging, (payload) => {
        const body = payload.notification?.body ?? payload.notification?.title;
        if (body) setToast(body);
      });
    })();
    return () => unsubscribe?.();
  }, []);

  // Sign-out: never delete the server-side registration (the server prunes
  // dead tokens itself — plan §11), just forget the local token so this
  // device doesn't silently keep "belonging" to whoever signs in next.
  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      if (!user) {
        localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
      }
    });
  }, []);

  async function enable(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const messaging = await getMessagingIfSupported();
      if (!messaging || typeof Notification === 'undefined') {
        setState('unsupported');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'prompt');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const token = await getToken(messaging, getTokenOptions(registration));
      if (!token) {
        setState('error');
        setError({ code: 'no-token', message: 'No push token was issued.' });
        return;
      }
      const oldToken = localStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
      await registerDevice({ token, platform: 'web', label: browserDeviceLabel(navigator.userAgent) });
      if (oldToken && oldToken !== token) {
        await unregisterDevice({ token: oldToken }).catch(() => undefined);
      }
      localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
      setState('enabled');
    } catch (err) {
      setState('error');
      setError(toAppError(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function disable(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const token = localStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
      if (token) {
        await unregisterDevice({ token }).catch(() => undefined);
      }
      const messaging = await getMessagingIfSupported();
      if (messaging) {
        await deleteToken(messaging).catch(() => undefined);
      }
      localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
      setState(
        typeof Notification !== 'undefined' && Notification.permission === 'denied' ? 'denied' : 'prompt',
      );
    } catch (err) {
      setState('error');
      setError(toAppError(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function dismissToast(): void {
    setToast(null);
  }

  return { state, busy, isIos: IOS_UA.test(navigator.userAgent), error, toast, dismissToast, enable, disable };
}

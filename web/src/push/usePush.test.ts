import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePush, PUSH_TOKEN_STORAGE_KEY } from './usePush';

const registerDevice = vi.fn();
const unregisterDevice = vi.fn();
vi.mock('./api', () => ({ registerDevice: (...args: unknown[]) => registerDevice(...args), unregisterDevice: (...args: unknown[]) => unregisterDevice(...args) }));

const getMessagingIfSupported = vi.fn();
vi.mock('../firebase', () => ({
  auth: {},
  getMessagingIfSupported: (...args: unknown[]) => getMessagingIfSupported(...args),
  toAppError: (err: unknown) => (err && typeof err === 'object' && 'code' in err ? err : { code: 'unknown', message: 'x' }),
}));

const getToken = vi.fn();
const deleteToken = vi.fn();
const onMessage = vi.fn((..._args: unknown[]) => () => undefined);
vi.mock('firebase/messaging', () => ({
  getToken: (...args: unknown[]) => getToken(...args),
  deleteToken: (...args: unknown[]) => deleteToken(...args),
  onMessage: (...args: unknown[]) => onMessage(...args),
}));

const onAuthStateChanged = vi.fn((..._args: unknown[]) => () => undefined);
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (...args: unknown[]) => onAuthStateChanged(...args),
}));

const FAKE_MESSAGING = { app: 'fake' };

function stubServiceWorker() {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({}) },
  });
}

function stubNotification(initialPermission: NotificationPermission) {
  const requestPermission = vi.fn(async () => initialPermission);
  // @ts-expect-error -- test-only global stub; jsdom has no Notification API.
  global.Notification = { permission: initialPermission, requestPermission };
  return requestPermission;
}

/**
 * This project's jsdom test environment doesn't reliably expose a working
 * `localStorage` (Node's own experimental Web Storage global shadows
 * jsdom's, and evaluates to `undefined`) — an environment quirk unrelated
 * to `usePush`'s own logic. Install a minimal in-memory stand-in so the
 * hook's real `localStorage.getItem/setItem/removeItem` calls have
 * something to talk to.
 */
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
      clear: () => {
        store.clear();
      },
    },
  });
}

beforeEach(() => {
  stubLocalStorage();
  registerDevice.mockReset().mockResolvedValue({ ok: true });
  unregisterDevice.mockReset().mockResolvedValue({ ok: true });
  getMessagingIfSupported.mockReset().mockResolvedValue(FAKE_MESSAGING);
  getToken.mockReset();
  deleteToken.mockReset().mockResolvedValue(true);
  stubServiceWorker();
});

afterEach(() => {
  // @ts-expect-error -- undo the test-only stub.
  delete global.Notification;
});

describe('usePush', () => {
  it('reports unsupported when the browser cannot do push', async () => {
    getMessagingIfSupported.mockResolvedValue(null);
    const { result } = renderHook(() => usePush());
    await waitFor(() => expect(result.current.state).toBe('unsupported'));
  });

  it('reports denied when permission was already denied', async () => {
    stubNotification('denied');
    const { result } = renderHook(() => usePush());
    await waitFor(() => expect(result.current.state).toBe('denied'));
  });

  it('reports prompt when permission has not been decided', async () => {
    stubNotification('default');
    const { result } = renderHook(() => usePush());
    await waitFor(() => expect(result.current.state).toBe('prompt'));
  });

  it('enable() requests permission, gets a token, and registers this device', async () => {
    const requestPermission = stubNotification('default');
    requestPermission.mockResolvedValue('granted');
    getToken.mockResolvedValue('token-abc');

    const { result } = renderHook(() => usePush());
    await waitFor(() => expect(result.current.state).toBe('prompt'));

    await act(async () => {
      await result.current.enable();
    });

    expect(requestPermission).toHaveBeenCalled();
    expect(registerDevice).toHaveBeenCalledWith({ token: 'token-abc', platform: 'web', label: expect.any(String) });
    expect(unregisterDevice).not.toHaveBeenCalled();
    expect(result.current.state).toBe('enabled');
    expect(localStorage.getItem(PUSH_TOKEN_STORAGE_KEY)).toBe('token-abc');
  });

  it('enable() moves to denied when the user declines the browser prompt', async () => {
    const requestPermission = stubNotification('default');
    requestPermission.mockResolvedValue('denied');

    const { result } = renderHook(() => usePush());
    await waitFor(() => expect(result.current.state).toBe('prompt'));

    await act(async () => {
      await result.current.enable();
    });

    expect(getToken).not.toHaveBeenCalled();
    expect(result.current.state).toBe('denied');
  });

  it('detects token rotation on mount: unregisters the old token and registers the new one', async () => {
    localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, 'old-token');
    stubNotification('granted');
    getToken.mockResolvedValue('new-token');

    const { result } = renderHook(() => usePush());

    await waitFor(() => expect(result.current.state).toBe('enabled'));
    expect(registerDevice).toHaveBeenCalledWith({ token: 'new-token', platform: 'web', label: expect.any(String) });
    expect(unregisterDevice).toHaveBeenCalledWith({ token: 'old-token' });
    expect(localStorage.getItem(PUSH_TOKEN_STORAGE_KEY)).toBe('new-token');
  });

  it('does not re-register when the token has not rotated', async () => {
    localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, 'same-token');
    stubNotification('granted');
    getToken.mockResolvedValue('same-token');

    const { result } = renderHook(() => usePush());

    await waitFor(() => expect(result.current.state).toBe('enabled'));
    expect(registerDevice).not.toHaveBeenCalled();
    expect(unregisterDevice).not.toHaveBeenCalled();
  });

  it('disable() unregisters the device and deletes the local token', async () => {
    localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, 'tok-1');
    stubNotification('granted');
    getToken.mockResolvedValue('tok-1');

    const { result } = renderHook(() => usePush());
    await waitFor(() => expect(result.current.state).toBe('enabled'));

    await act(async () => {
      await result.current.disable();
    });

    expect(unregisterDevice).toHaveBeenCalledWith({ token: 'tok-1' });
    expect(deleteToken).toHaveBeenCalledWith(FAKE_MESSAGING);
    expect(localStorage.getItem(PUSH_TOKEN_STORAGE_KEY)).toBeNull();
    expect(result.current.state).toBe('prompt');
  });
});

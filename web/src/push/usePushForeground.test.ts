import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePushForeground } from './usePushForeground';

const getMessagingIfSupported = vi.fn();
vi.mock('../firebase', () => ({
  getMessagingIfSupported: (...args: unknown[]) => getMessagingIfSupported(...args),
}));

type OnMessageCallback = (payload: {
  notification?: { title?: string; body?: string };
  data?: Record<string, string>;
}) => void;
let onMessageCallback: OnMessageCallback | undefined;
const onMessage = vi.fn((_messaging: unknown, cb: OnMessageCallback) => {
  onMessageCallback = cb;
  return () => {
    onMessageCallback = undefined;
  };
});
vi.mock('firebase/messaging', () => ({
  onMessage: (...args: [unknown, OnMessageCallback]) => onMessage(...args),
}));

const FAKE_MESSAGING = { app: 'fake' };

beforeEach(() => {
  onMessageCallback = undefined;
  getMessagingIfSupported.mockReset().mockResolvedValue(FAKE_MESSAGING);
  onMessage.mockClear();
});

describe('usePushForeground', () => {
  it('starts with no toast', () => {
    const { result } = renderHook(() => usePushForeground());
    expect(result.current.toast).toBeNull();
  });

  it('does nothing when the browser cannot do push', async () => {
    getMessagingIfSupported.mockResolvedValue(null);
    renderHook(() => usePushForeground());
    await waitFor(() => expect(getMessagingIfSupported).toHaveBeenCalled());
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('shows the notification body as a toast on a foreground message', async () => {
    const { result } = renderHook(() => usePushForeground());
    await waitFor(() => expect(onMessageCallback).toBeDefined());

    act(() => {
      onMessageCallback!({ notification: { title: 'Invite', body: 'Alice invited you' } });
    });

    expect(result.current.toast).toBe('Alice invited you');
  });

  it('falls back to data.body for a data-only web push (task deliverable F)', async () => {
    const { result } = renderHook(() => usePushForeground());
    await waitFor(() => expect(onMessageCallback).toBeDefined());

    act(() => {
      onMessageCallback!({ data: { title: 'Invite', body: 'Bob invited you' } });
    });

    expect(result.current.toast).toBe('Bob invited you');
  });

  it('dismissToast clears the toast', async () => {
    const { result } = renderHook(() => usePushForeground());
    await waitFor(() => expect(onMessageCallback).toBeDefined());

    act(() => {
      onMessageCallback!({ notification: { body: 'Hello' } });
    });
    expect(result.current.toast).toBe('Hello');

    act(() => {
      result.current.dismissToast();
    });
    expect(result.current.toast).toBeNull();
  });
});

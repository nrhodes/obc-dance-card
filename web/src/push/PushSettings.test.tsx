import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MemberPrivate } from '@obc/shared';
import type { UsePushResult } from './usePush';
import { PushSettings } from './PushSettings';

const useAuthMock = vi.fn<() => { memberPrivate: MemberPrivate | null }>();
vi.mock('../auth/useAuth', () => ({ useAuth: () => useAuthMock() }));

const usePushMock = vi.fn<() => UsePushResult>();
vi.mock('./usePush', () => ({ usePush: () => usePushMock() }));

function memberPrivate(push: boolean): MemberPrivate {
  return {
    id: 'm1',
    emailLower: 'a@example.org',
    notificationPrefs: {
      push,
      email: true,
      reminders: true,
      matchmakingAlerts: false,
      digest: 'immediate',
      reminderDaysBefore: 2,
    },
    devices: [],
    hasPassword: false,
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
  };
}

function push(overrides: Partial<UsePushResult>): UsePushResult {
  return {
    state: 'prompt',
    busy: false,
    isIos: false,
    error: null,
    enable: vi.fn(),
    disable: vi.fn(),
    ...overrides,
  };
}

describe('PushSettings', () => {
  it('shows the generic unsupported message on a non-iOS unsupported browser', () => {
    useAuthMock.mockReturnValue({ memberPrivate: memberPrivate(true) });
    usePushMock.mockReturnValue(push({ state: 'unsupported', isIos: false }));
    render(<PushSettings />);
    expect(screen.getByText(/doesn't support push notifications/i)).toBeTruthy();
  });

  it('shows the iOS Home Screen hint when unsupported on iOS', () => {
    useAuthMock.mockReturnValue({ memberPrivate: memberPrivate(true) });
    usePushMock.mockReturnValue(push({ state: 'unsupported', isIos: true }));
    render(<PushSettings />);
    expect(screen.getByText(/Add this site to your Home Screen/i)).toBeTruthy();
  });

  it('shows the blocked-in-browser message when denied', () => {
    useAuthMock.mockReturnValue({ memberPrivate: memberPrivate(true) });
    usePushMock.mockReturnValue(push({ state: 'denied' }));
    render(<PushSettings />);
    expect(screen.getByText(/blocked for this site/i)).toBeTruthy();
  });

  it('shows the turn-on button when prompt and prefs allow push', async () => {
    const user = userEvent.setup();
    const enable = vi.fn();
    useAuthMock.mockReturnValue({ memberPrivate: memberPrivate(true) });
    usePushMock.mockReturnValue(push({ state: 'prompt', enable }));
    render(<PushSettings />);
    const button = screen.getByRole('button', { name: /turn on notifications on this device/i });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await user.click(button);
    expect(enable).toHaveBeenCalled();
  });

  it('disables the turn-on button and explains when prefs.push is off', () => {
    useAuthMock.mockReturnValue({ memberPrivate: memberPrivate(false) });
    usePushMock.mockReturnValue(push({ state: 'prompt' }));
    render(<PushSettings />);
    const button = screen.getByRole('button', { name: /turn on notifications on this device/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/turned off in your preferences/i)).toBeTruthy();
  });

  it('shows the turn-off button when enabled', async () => {
    const user = userEvent.setup();
    const disable = vi.fn();
    useAuthMock.mockReturnValue({ memberPrivate: memberPrivate(true) });
    usePushMock.mockReturnValue(push({ state: 'enabled', disable }));
    render(<PushSettings />);
    const button = screen.getByRole('button', { name: /turn off on this device/i });
    await user.click(button);
    expect(disable).toHaveBeenCalled();
  });

  it('shows an error message in state error', () => {
    useAuthMock.mockReturnValue({ memberPrivate: memberPrivate(true) });
    usePushMock.mockReturnValue(
      push({ state: 'error', error: { code: 'unknown', message: 'boom' } }),
    );
    render(<PushSettings />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});

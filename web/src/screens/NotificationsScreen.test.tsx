import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type * as ReactRouterDom from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Notification } from '@obc/shared';
import { NotificationsScreen } from './NotificationsScreen';

const markNotificationsReadMock = vi.fn();
const navigateMock = vi.fn();

vi.mock('../api', () => ({
  markNotificationsRead: (...args: unknown[]) => markNotificationsReadMock(...args),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof ReactRouterDom>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

let notificationsFixture: { notifications: Notification[]; unreadCount: number; loading: boolean } = {
  notifications: [],
  unreadCount: 0,
  loading: false,
};

vi.mock('../notifications/useNotifications', () => ({
  useNotifications: () => notificationsFixture,
}));

function notification(overrides: Partial<Notification>): Notification {
  return {
    id: 'n1',
    memberId: 'member-a',
    type: 'invite_received',
    title: 'You have a new partner invite',
    body: 'John Smith would like to play with you.',
    data: {},
    channelsSent: [],
    read: false,
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderScreen() {
  return render(
    <MemoryRouter>
      <NotificationsScreen />
    </MemoryRouter>,
  );
}

describe('NotificationsScreen', () => {
  it('shows an empty state', () => {
    notificationsFixture = { notifications: [], unreadCount: 0, loading: false };
    renderScreen();
    expect(screen.getByText('Nothing here yet.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Mark all read' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('styles unread notifications distinctly', () => {
    notificationsFixture = {
      notifications: [
        notification({ id: 'n-unread', title: 'Unread one', read: false }),
        notification({ id: 'n-read', title: 'Read one', read: true }),
      ],
      unreadCount: 1,
      loading: false,
    };
    renderScreen();
    const unreadButton = screen.getByText('Unread one').closest('button')!;
    const readButton = screen.getByText('Read one').closest('button')!;
    expect(unreadButton.className).toContain('notification-item-unread');
    expect(readButton.className).not.toContain('notification-item-unread');
  });

  it('marks a notification read and follows its session deep link', async () => {
    markNotificationsReadMock.mockResolvedValueOnce({ ok: true });
    notificationsFixture = {
      notifications: [notification({ id: 'n1', data: { sessionId: 's1', year: '2027' } })],
      unreadCount: 1,
      loading: false,
    };
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByText('You have a new partner invite'));
    expect(markNotificationsReadMock).toHaveBeenCalledWith({ ids: ['n1'] });
    expect(navigateMock).toHaveBeenCalledWith('/session/2027/s1');
  });

  it('follows an invite deep link to /invites', async () => {
    markNotificationsReadMock.mockResolvedValueOnce({ ok: true });
    notificationsFixture = {
      notifications: [notification({ id: 'n2', data: { inviteId: 'invite-1' } })],
      unreadCount: 1,
      loading: false,
    };
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByText('You have a new partner invite'));
    expect(navigateMock).toHaveBeenCalledWith('/invites');
  });

  it('marks all unread as read', async () => {
    markNotificationsReadMock.mockResolvedValueOnce({ ok: true });
    notificationsFixture = {
      notifications: [notification({ id: 'n1', read: false }), notification({ id: 'n2', read: false })],
      unreadCount: 2,
      loading: false,
    };
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(markNotificationsReadMock).toHaveBeenCalledWith({ ids: ['n1', 'n2'] });
  });
});

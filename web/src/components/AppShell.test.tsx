/**
 * AppShell: admin nav rows and the acting-as banner (plan Phase 6b task
 * deliverable 7: "Admin section in AppShell... The acting-as banner sits
 * above the main content").
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Member } from '@obc/shared';
import { AppShell } from './AppShell';

let memberFixture: Member | null = null;
let actingAsFixture: { memberId: string; name: string } | null = null;
let toastFixture: string | null = null;
let needsRefreshFixture = false;
const stopActingAsMock = vi.fn();
const signOutMock = vi.fn();
const dismissToastMock = vi.fn();
const reloadMock = vi.fn();

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ member: memberFixture, signOut: signOutMock }),
}));

vi.mock('../invites/useInvites', () => ({
  useInvites: () => ({ incoming: [] }),
}));

vi.mock('../notifications/useNotifications', () => ({
  useNotifications: () => ({ unreadCount: 0 }),
}));

vi.mock('../admin/useActingAs', () => ({
  useActingAs: () => ({
    actingAs: actingAsFixture,
    startActingAs: vi.fn(),
    stopActingAs: stopActingAsMock,
  }),
}));

vi.mock('../push/usePushForeground', () => ({
  usePushForeground: () => ({ toast: toastFixture, dismissToast: dismissToastMock }),
}));

vi.mock('../pwa/usePwaUpdate', () => ({
  usePwaUpdate: () => ({ needsRefresh: needsRefreshFixture, reload: reloadMock }),
}));

vi.mock('../session/useIdleSignOut', () => ({
  useIdleSignOut: () => undefined,
}));

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: 'member-a',
    firstName: 'Jane',
    lastName: 'Doe',
    phone: '',
    grade: 'Open',
    role: 'member',
    active: true,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<AppShell />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  it('shows the admin nav section only for an admin', () => {
    memberFixture = member({ role: 'member' });
    actingAsFixture = null;
    renderShell();
    expect(screen.queryByRole('link', { name: 'Admin: Members' })).toBeNull();

    memberFixture = member({ role: 'admin' });
    renderShell();
    expect(screen.getByRole('link', { name: 'Admin: Members' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Admin: Programme' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Admin: Broadcast' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Admin: Audit log' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Admin: Integrity' })).toBeTruthy();
  });

  it('shows the acting-as banner with a Stop button when acting on behalf of a member', async () => {
    memberFixture = member({ role: 'admin' });
    actingAsFixture = { memberId: 'member-b', name: 'John Smith' };
    const user = userEvent.setup();
    renderShell();

    expect(screen.getByText(/Acting on behalf of/)).toBeTruthy();
    expect(screen.getByText('John Smith')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(stopActingAsMock).toHaveBeenCalled();
  });

  it('shows no banner when not acting on behalf of anyone', () => {
    memberFixture = member({ role: 'admin' });
    actingAsFixture = null;
    renderShell();
    expect(screen.queryByText(/Acting on behalf of/)).toBeNull();
  });

  it('shows a "Not you? Sign out" link that signs out (task deliverable C)', async () => {
    memberFixture = member();
    actingAsFixture = null;
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: /not you\? sign out/i }));
    expect(signOutMock).toHaveBeenCalled();
  });

  it('has a Help link in the main nav', () => {
    memberFixture = member();
    renderShell();
    expect(screen.getByRole('link', { name: 'Help' })).toBeTruthy();
  });

  it('shows a dismissible foreground push toast from anywhere in the app (task deliverable F)', async () => {
    memberFixture = member();
    toastFixture = 'Your partner accepted';
    const user = userEvent.setup();
    renderShell();
    const statuses = screen.getAllByRole('status');
    expect(statuses.some((el) => /Your partner accepted/.test(el.textContent ?? ''))).toBe(true);
    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(dismissToastMock).toHaveBeenCalled();
    toastFixture = null;
  });

  it('shows a PWA update prompt when a new version is waiting (task deliverable D)', async () => {
    memberFixture = member();
    needsRefreshFixture = true;
    const user = userEvent.setup();
    renderShell();
    expect(screen.getByText(/new version is ready/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /reload/i }));
    expect(reloadMock).toHaveBeenCalled();
    needsRefreshFixture = false;
  });
});

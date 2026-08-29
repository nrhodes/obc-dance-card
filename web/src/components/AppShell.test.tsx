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
const stopActingAsMock = vi.fn();

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ member: memberFixture, signOut: vi.fn() }),
}));

vi.mock('../invites/useInvites', () => ({
  useInvites: () => ({ incoming: [] }),
}));

vi.mock('../notifications/useNotifications', () => ({
  useNotifications: () => ({ unreadCount: 0 }),
}));

vi.mock('../admin/useActingAs', () => ({
  useActingAs: () => ({ actingAs: actingAsFixture, startActingAs: vi.fn(), stopActingAs: stopActingAsMock }),
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
});

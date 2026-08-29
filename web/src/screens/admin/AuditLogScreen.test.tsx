/**
 * Admin: Audit log (plan §9.2 `listAuditLog`, Phase 6b task deliverable 5 +
 * Tests section: "audit log paging + filters + <pre> rendering").
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AuditLogEntry, Member } from '@obc/shared';
import { AuditLogScreen } from './AuditLogScreen';

vi.mock('../../members/useMembersDirectory', () => ({
  useMembersDirectory: () => ({
    members: [member({ id: 'admin-1', firstName: 'Admin', lastName: 'User' })],
    byId: new Map(),
    nameOf: (id: string) => (id === 'admin-1' ? 'Admin User' : id),
    loading: false,
    error: null,
  }),
}));

const listAuditLogMock = vi.fn();
vi.mock('../../api', () => ({
  listAuditLog: (...args: unknown[]) => listAuditLogMock(...args),
}));

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: 'admin-1',
    firstName: 'Admin',
    lastName: 'User',
    phone: '',
    grade: 'Open',
    role: 'admin',
    active: true,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function auditEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 'audit-1',
    at: '2027-06-01T02:00:00.000Z',
    actorMemberId: 'admin-1',
    action: 'set_solo_status_on_behalf',
    detail: { note: 'looking_for_partner' },
    ...overrides,
  };
}

beforeEach(() => {
  listAuditLogMock.mockReset();
});

function renderScreen() {
  return render(
    <MemoryRouter>
      <AuditLogScreen />
    </MemoryRouter>,
  );
}

describe('AuditLogScreen', () => {
  it('loads the first page and renders a row', async () => {
    listAuditLogMock.mockResolvedValueOnce({ entries: [auditEntry()], nextBefore: undefined });
    renderScreen();
    expect(await screen.findByText('set_solo_status_on_behalf')).toBeTruthy();
    expect(screen.getByText('Admin User')).toBeTruthy();
    expect(listAuditLogMock).toHaveBeenCalledWith({ limit: 50 });
  });

  it('renders detail/before/after as text inside a <pre> element, not HTML', async () => {
    listAuditLogMock.mockResolvedValueOnce({
      entries: [auditEntry({ detail: { html: '<img src=x onerror=alert(1)>' } })],
      nextBefore: undefined,
    });
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('set_solo_status_on_behalf');
    await user.click(screen.getByRole('button', { name: 'Details' }));
    const pre = document.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(pre!.querySelector('img')).toBeNull();
  });

  it('loads the next page via "Load more" using nextBefore', async () => {
    listAuditLogMock
      .mockResolvedValueOnce({ entries: [auditEntry({ id: 'a1', at: '2027-06-02T00:00:00.000Z' })], nextBefore: '2027-06-02T00:00:00.000Z' })
      .mockResolvedValueOnce({ entries: [auditEntry({ id: 'a2', at: '2027-06-01T00:00:00.000Z' })], nextBefore: undefined });
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('set_solo_status_on_behalf');
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(listAuditLogMock).toHaveBeenLastCalledWith({ limit: 50, before: '2027-06-02T00:00:00.000Z' });
    await screen.findByRole('button', { name: 'No more entries' });
  });

  it('filters by action and re-queries with only that filter', async () => {
    listAuditLogMock.mockResolvedValue({ entries: [], nextBefore: undefined });
    const user = userEvent.setup();
    renderScreen();
    await user.selectOptions(screen.getByLabelText('Filter by'), 'action');
    await user.selectOptions(screen.getByLabelText('Action'), 'broadcast_sent');
    expect(listAuditLogMock).toHaveBeenLastCalledWith({ limit: 50, action: 'broadcast_sent' });
  });

  it('filters by target member', async () => {
    listAuditLogMock.mockResolvedValue({ entries: [], nextBefore: undefined });
    const user = userEvent.setup();
    renderScreen();
    await user.selectOptions(screen.getByLabelText('Filter by'), 'target');
    await user.selectOptions(screen.getByLabelText('Target member'), 'admin-1');
    expect(listAuditLogMock).toHaveBeenLastCalledWith({ limit: 50, targetMemberId: 'admin-1' });
  });
});

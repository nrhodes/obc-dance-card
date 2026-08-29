/**
 * Admin: Members table (plan §9.2, Phase 6b task deliverable 2 + Tests
 * section: "members table filters + each row action's dialog and error
 * mapping (last-admin, erase name mismatch, 30-day)").
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Member } from '@obc/shared';
import { MembersTable } from './MembersTable';

let membersFixture: Member[] = [];
const startActingAsMock = vi.fn();

vi.mock('../../firebase', () => ({ db: {} }));

vi.mock('../../admin/useActingAs', () => ({
  useActingAs: () => ({ actingAs: null, startActingAs: startActingAsMock, stopActingAs: vi.fn() }),
}));

vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  onSnapshot: (_q: unknown, onNext: (snap: { docs: Array<{ data: () => unknown }> }) => void) => {
    onNext({ docs: membersFixture.map((m) => ({ data: () => m })) });
    return () => {};
  },
}));

const setMemberRoleMock = vi.fn();
const deactivateMemberMock = vi.fn();
const reactivateMemberMock = vi.fn();
const eraseMemberMock = vi.fn();

vi.mock('../../api', () => ({
  setMemberRole: (...args: unknown[]) => setMemberRoleMock(...args),
  deactivateMember: (...args: unknown[]) => deactivateMemberMock(...args),
  reactivateMember: (...args: unknown[]) => reactivateMemberMock(...args),
  eraseMember: (...args: unknown[]) => eraseMemberMock(...args),
}));

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: 'member-a',
    firstName: 'Jane',
    lastName: 'Doe',
    phone: '021 555 0100',
    grade: 'Open',
    role: 'member',
    active: true,
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  setMemberRoleMock.mockReset();
  deactivateMemberMock.mockReset();
  reactivateMemberMock.mockReset();
  eraseMemberMock.mockReset();
  startActingAsMock.mockReset();
});

describe('MembersTable', () => {
  it('filters by search text, status, and role', async () => {
    membersFixture = [
      member({ id: 'm1', firstName: 'Jane', lastName: 'Doe', active: true, role: 'admin' }),
      member({ id: 'm2', firstName: 'John', lastName: 'Smith', active: false, role: 'member' }),
      member({ id: 'm3', firstName: 'Amy', lastName: 'Lee', active: true, role: 'member' }),
    ];
    const user = userEvent.setup();
    render(<MembersTable />);

    expect(screen.getByText('Jane Doe')).toBeTruthy();
    expect(screen.getByText('John Smith')).toBeTruthy();
    expect(screen.getByText('Amy Lee')).toBeTruthy();

    await user.type(screen.getByLabelText('Search by name'), 'john');
    expect(screen.queryByText('Jane Doe')).toBeNull();
    expect(screen.getByText('John Smith')).toBeTruthy();
    await user.clear(screen.getByLabelText('Search by name'));

    await user.selectOptions(screen.getByLabelText('Filter by status'), 'inactive');
    expect(screen.getByText('John Smith')).toBeTruthy();
    expect(screen.queryByText('Jane Doe')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'all');

    await user.selectOptions(screen.getByLabelText('Filter by role'), 'admin');
    expect(screen.getByText('Jane Doe')).toBeTruthy();
    expect(screen.queryByText('Amy Lee')).toBeNull();
  });

  it('shows the last-admin failed-precondition error verbatim on Remove admin', async () => {
    membersFixture = [member({ id: 'm1', role: 'admin' })];
    setMemberRoleMock.mockRejectedValueOnce({ code: 'failed-precondition', message: 'You cannot demote the only active admin.' });
    const user = userEvent.setup();
    render(<MembersTable />);

    await user.click(screen.getByRole('button', { name: 'Remove admin' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove admin' }));

    expect(setMemberRoleMock).toHaveBeenCalledWith({ memberId: 'm1', role: 'member' });
    expect(within(dialog).getByText('You cannot demote the only active admin.')).toBeTruthy();
  });

  it('requires the exact confirmName and shows the 30-day rule; shows the server error verbatim on mismatch', async () => {
    membersFixture = [member({ id: 'm1', firstName: 'Jane', lastName: 'Doe', active: false })];
    eraseMemberMock.mockRejectedValueOnce({
      code: 'failed-precondition',
      message: 'Members must be deactivated for at least 30 days before they can be erased.',
    });
    const user = userEvent.setup();
    render(<MembersTable />);

    await user.click(screen.getByRole('button', { name: 'Erase' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/30 days/)).toBeTruthy();

    const eraseButton = within(dialog).getByRole('button', { name: 'Erase permanently' }) as HTMLButtonElement;
    expect(eraseButton.disabled).toBe(true);

    await user.type(within(dialog).getByLabelText(/Type the member's full name/), 'Wrong Name');
    expect((within(dialog).getByRole('button', { name: 'Erase permanently' }) as HTMLButtonElement).disabled).toBe(true);

    await user.clear(within(dialog).getByLabelText(/Type the member's full name/));
    await user.type(within(dialog).getByLabelText(/Type the member's full name/), 'Jane Doe');
    await user.click(within(dialog).getByRole('button', { name: 'Erase permanently' }));

    expect(eraseMemberMock).toHaveBeenCalledWith({ memberId: 'm1', confirmName: 'Jane Doe' });
    expect(within(dialog).getByText('Members must be deactivated for at least 30 days before they can be erased.')).toBeTruthy();
  });

  it('deactivate dialog explains the cascade and passes an optional reason', async () => {
    membersFixture = [member({ id: 'm1' })];
    deactivateMemberMock.mockResolvedValueOnce({ member: member({ id: 'm1', active: false }), cancelledEntries: 0, expiredInvites: 0 });
    const user = userEvent.setup();
    render(<MembersTable />);

    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/future pairings will be cancelled/)).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Reason (optional)'), 'Moved away');
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }));

    expect(deactivateMemberMock).toHaveBeenCalledWith({ memberId: 'm1', reason: 'Moved away' });
  });

  it('only offers Reactivate/Erase for inactive members, and Act on behalf only for active members', () => {
    membersFixture = [member({ id: 'm1', active: true }), member({ id: 'm2', active: false })];
    render(<MembersTable />);

    const rows = screen.getAllByRole('row').slice(1); // skip header row
    expect(within(rows[0]!).queryByRole('button', { name: 'Reactivate' })).toBeNull();
    expect(within(rows[0]!).getByRole('button', { name: 'Act on behalf' })).toBeTruthy();
    expect(within(rows[1]!).getByRole('button', { name: 'Reactivate' })).toBeTruthy();
    expect(within(rows[1]!).getByRole('button', { name: 'Erase' })).toBeTruthy();
    expect(within(rows[1]!).queryByRole('button', { name: 'Act on behalf' })).toBeNull();
  });

  it('"Act on behalf" starts acting-as with the member id and name', async () => {
    membersFixture = [member({ id: 'm1', firstName: 'Jane', lastName: 'Doe' })];
    const user = userEvent.setup();
    render(<MembersTable />);
    await user.click(screen.getByRole('button', { name: 'Act on behalf' }));
    expect(startActingAsMock).toHaveBeenCalledWith({ memberId: 'm1', name: 'Jane Doe' });
  });
});

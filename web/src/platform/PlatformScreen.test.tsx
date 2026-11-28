/**
 * Platform area (plan §21 B14.3): lists clubs, and each action sends the
 * right request and reports the server's answer.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClubSummary } from '@obc/shared';
import { PlatformScreen } from './PlatformScreen';

const listClubsMock = vi.fn();
const createClubMock = vi.fn();
const updateClubMock = vi.fn();
const setClubAdminMock = vi.fn();

vi.mock('../api', () => ({
  listClubs: (...args: unknown[]) => listClubsMock(...args),
  createClub: (...args: unknown[]) => createClubMock(...args),
  updateClub: (...args: unknown[]) => updateClubMock(...args),
  setClubAdmin: (...args: unknown[]) => setClubAdminMock(...args),
}));

function summary(overrides: Partial<ClubSummary['club']> = {}, rest: Partial<ClubSummary> = {}): ClubSummary {
  return {
    club: {
      id: 'orewa',
      name: 'Orewa Bridge Club',
      shortName: 'Orewa',
      timezone: 'Pacific/Auckland',
      status: 'active',
      createdAt: '2026-11-28T00:00:00.000Z',
      updatedAt: '2026-11-28T00:00:00.000Z',
      ...overrides,
    },
    activeMembers: 33,
    admins: [{ memberId: 'u1', name: 'Jane Doe', email: 'jane@example.org' }],
    ...rest,
  };
}

beforeEach(() => {
  for (const m of [listClubsMock, createClubMock, updateClubMock, setClubAdminMock]) m.mockReset();
  listClubsMock.mockResolvedValue({
    clubs: [summary(), summary({ id: 'testclub', name: 'TestClub', shortName: 'Test', status: 'suspended' }, { activeMembers: 1, admins: [] })],
  });
});

describe('PlatformScreen', () => {
  it('lists every club with its status, member count and admins', async () => {
    render(<PlatformScreen />);
    const orewa = await screen.findByRole('region', { name: 'Orewa Bridge Club' });
    expect(within(orewa).getByText(/33 active members/)).toBeTruthy();
    expect(within(orewa).getByText('Jane Doe')).toBeTruthy();

    const test = screen.getByRole('region', { name: 'TestClub' });
    expect(within(test).getByText('Suspended')).toBeTruthy();
    expect(within(test).getByText(/1 active member\b/)).toBeTruthy();
    expect(within(test).getByText('No admins yet.')).toBeTruthy();
    expect(within(test).getByRole('button', { name: 'Reactivate' })).toBeTruthy();
  });

  it('creates a club: validates the id locally, then sends it and refreshes', async () => {
    createClubMock.mockResolvedValueOnce({ club: summary({ id: 'northshore' }).club });
    const user = userEvent.setup();
    render(<PlatformScreen />);
    await screen.findByRole('region', { name: 'Orewa Bridge Club' });

    await user.click(screen.getByRole('button', { name: 'Create a club' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'North Shore Bridge Club');
    await user.type(within(dialog).getByLabelText('Short name'), 'North Shore');
    await user.type(within(dialog).getByLabelText('Id'), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Create club' }));
    expect(within(dialog).getByRole('alert').textContent).toMatch(/2–40/);
    expect(createClubMock).not.toHaveBeenCalled();

    await user.clear(within(dialog).getByLabelText('Id'));
    await user.type(within(dialog).getByLabelText('Id'), 'NorthShore');
    await user.click(within(dialog).getByRole('button', { name: 'Create club' }));

    expect(createClubMock).toHaveBeenCalledWith({ clubId: 'northshore', name: 'North Shore Bridge Club', shortName: 'North Shore' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('North Shore Bridge Club has been created');
    expect(listClubsMock).toHaveBeenCalledTimes(2);
  });

  it('shows the server’s reason when an id is taken', async () => {
    createClubMock.mockRejectedValueOnce({ code: 'failed-precondition', message: 'A club with that id already exists.' });
    const user = userEvent.setup();
    render(<PlatformScreen />);
    await screen.findByRole('region', { name: 'Orewa Bridge Club' });

    await user.click(screen.getByRole('button', { name: 'Create a club' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Dup');
    await user.type(within(dialog).getByLabelText('Short name'), 'Dup');
    await user.type(within(dialog).getByLabelText('Id'), 'orewa');
    await user.click(within(dialog).getByRole('button', { name: 'Create club' }));
    expect(within(dialog).getByText('A club with that id already exists.')).toBeTruthy();
  });

  it('adds an admin by email, with a name only for someone new', async () => {
    setClubAdminMock.mockResolvedValue({ member: {}, membershipCreated: false });
    const user = userEvent.setup();
    render(<PlatformScreen />);
    const test = await screen.findByRole('region', { name: 'TestClub' });

    await user.click(within(test).getByRole('button', { name: 'Add an admin' }));
    let dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Their sign-in email'), ' Neil@Example.org ');
    await user.click(within(dialog).getByRole('button', { name: 'Add admin' }));
    expect(setClubAdminMock).toHaveBeenLastCalledWith({ clubId: 'testclub', email: 'neil@example.org', admin: true });

    await user.click(within(screen.getByRole('region', { name: 'TestClub' })).getByRole('button', { name: 'Add an admin' }));
    dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Their sign-in email'), 'new@example.org');
    await user.type(within(dialog).getByLabelText(/First name/), 'Nia');
    await user.click(within(dialog).getByRole('button', { name: 'Add admin' }));
    expect(within(dialog).getByRole('alert').textContent).toMatch(/both a first and a last name/);
    await user.type(within(dialog).getByLabelText(/Last name/), 'New');
    await user.click(within(dialog).getByRole('button', { name: 'Add admin' }));
    expect(setClubAdminMock).toHaveBeenLastCalledWith({
      clubId: 'testclub',
      email: 'new@example.org',
      admin: true,
      firstName: 'Nia',
      lastName: 'New',
    });
  });

  it('removes an admin after confirming, and shows the last-admin refusal', async () => {
    setClubAdminMock.mockRejectedValueOnce({
      code: 'failed-precondition',
      message: 'That would leave the club with no active admin. Appoint another first.',
    });
    const user = userEvent.setup();
    render(<PlatformScreen />);
    const orewa = await screen.findByRole('region', { name: 'Orewa Bridge Club' });

    await user.click(within(orewa).getByRole('button', { name: 'Remove admin' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Jane Doe will stay a member/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Remove admin' }));
    expect(setClubAdminMock).toHaveBeenCalledWith({ clubId: 'orewa', email: 'jane@example.org', admin: false });
    expect(within(dialog).getByText(/no active admin/)).toBeTruthy();
  });

  it('suspends and reactivates after confirming, and renames', async () => {
    updateClubMock.mockResolvedValue({ club: {}, changed: true });
    const user = userEvent.setup();
    render(<PlatformScreen />);
    const orewa = await screen.findByRole('region', { name: 'Orewa Bridge Club' });

    await user.click(within(orewa).getByRole('button', { name: 'Suspend' }));
    let dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/will not be able to sign in/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Suspend' }));
    expect(updateClubMock).toHaveBeenLastCalledWith({ clubId: 'orewa', patch: { status: 'suspended' } });

    await user.click(within(screen.getByRole('region', { name: 'TestClub' })).getByRole('button', { name: 'Reactivate' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reactivate' }));
    expect(updateClubMock).toHaveBeenLastCalledWith({ clubId: 'testclub', patch: { status: 'active' } });

    await user.click(within(screen.getByRole('region', { name: 'TestClub' })).getByRole('button', { name: 'Rename' }));
    dialog = screen.getByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'Practice Club');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(updateClubMock).toHaveBeenLastCalledWith({ clubId: 'testclub', patch: { name: 'Practice Club' } });
  });

  it('says so when the list cannot be loaded', async () => {
    listClubsMock.mockReset();
    listClubsMock.mockRejectedValueOnce({ code: 'permission-denied', message: 'Platform administrators only.' });
    render(<PlatformScreen />);
    expect((await screen.findByRole('alert')).textContent).toContain("You can't do that.");
  });
});

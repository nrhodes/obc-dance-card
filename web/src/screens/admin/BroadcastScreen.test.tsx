/**
 * Admin: Broadcast (plan §9.2 `broadcast`, Phase 6b task deliverable 4 +
 * Tests section: "broadcast preview/confirm").
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Entry, Member } from '@obc/shared';
import { BroadcastScreen } from './BroadcastScreen';

let activeMembersFixture: Member[] = [];
let futureEntriesFixture: Entry[] = [];

vi.mock('../../firebase', () => ({ db: {} }));

vi.mock('../../members/useMembersDirectory', () => ({
  useMembersDirectory: () => ({ members: activeMembersFixture, byId: new Map(), nameOf: (id: string) => id, loading: false, error: null }),
}));

vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: (base: unknown) => base,
  where: () => ({}),
  onSnapshot: (_q: unknown, onNext: (snap: { docs: Array<{ data: () => unknown }> }) => void) => {
    onNext({ docs: futureEntriesFixture.map((e) => ({ data: () => e })) });
    return () => {};
  },
}));

const broadcastMock = vi.fn();
vi.mock('../../api', () => ({
  broadcast: (...args: unknown[]) => broadcastMock(...args),
}));

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm1',
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

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'e1',
    sessionId: 's1',
    date: '2027-06-01',
    weekday: 'monday',
    seriesId: null,
    memberId: 'm1',
    status: 'confirmed',
    partner: null,
    pairingId: null,
    teamId: null,
    teamSessionOnly: false,
    substitute: null,
    partnerSubstitute: null,
    isSubstituteFor: null,
    createdBy: 'm1',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

beforeEach(() => {
  broadcastMock.mockReset();
});

describe('BroadcastScreen', () => {
  it('previews "all active members" with no weekday filter, then confirms and sends', async () => {
    activeMembersFixture = [member({ id: 'm1' }), member({ id: 'm2' })];
    futureEntriesFixture = [];
    broadcastMock.mockResolvedValueOnce({ recipients: 2 });
    const user = userEvent.setup();
    render(<BroadcastScreen />);

    await user.type(screen.getByLabelText(/Title/), 'Club closed');
    await user.type(screen.getByLabelText(/Message/), 'No bridge this Friday.');

    expect(screen.getByText(/notify/)).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Preview & send' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/This will notify 2 members/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));

    expect(broadcastMock).toHaveBeenCalledWith({ title: 'Club closed', body: 'No bridge this Friday.' });
    expect(screen.getByText(/Sent to 2 members/)).toBeTruthy();
  });

  it('narrows the preview count to active members with a future entry on the checked weekday', async () => {
    activeMembersFixture = [member({ id: 'm1' }), member({ id: 'm2' }), member({ id: 'm3' })];
    futureEntriesFixture = [
      entry({ memberId: 'm1', weekday: 'monday' }),
      entry({ memberId: 'm2', weekday: 'tuesday' }),
    ];
    const user = userEvent.setup();
    render(<BroadcastScreen />);

    await user.click(screen.getByRole('checkbox', { name: 'Monday' }));
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('maps a rate-limit error from a confirmed send', async () => {
    activeMembersFixture = [member({ id: 'm1' })];
    futureEntriesFixture = [];
    broadcastMock.mockRejectedValueOnce({ code: 'resource-exhausted', message: 'nope' });
    const user = userEvent.setup();
    render(<BroadcastScreen />);

    await user.type(screen.getByLabelText(/Title/), 'Title');
    await user.type(screen.getByLabelText(/Message/), 'Body');
    await user.click(screen.getByRole('button', { name: 'Preview & send' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send' }));

    expect(screen.getAllByText(/Too many requests/).length).toBeGreaterThan(0);
  });
});

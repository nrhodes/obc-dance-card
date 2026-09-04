import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import type { Member } from '@obc/shared';
import { MembersScreen } from './MembersScreen';

let membersFixture: Member[] = [];
let errorFixture: { code: string } | null = null;
let loadingFixture = false;

vi.mock('../members/useMembersDirectory', () => ({
  useMembersDirectory: () => ({
    members: membersFixture,
    byId: new Map(membersFixture.map((m) => [m.id, m])),
    nameOf: (id: string) => membersFixture.find((m) => m.id === id)?.firstName ?? id,
    loading: loadingFixture,
    error: errorFixture,
  }),
}));

afterEach(() => {
  membersFixture = [];
  errorFixture = null;
  loadingFixture = false;
});

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm1',
    firstName: 'Jane',
    lastName: 'Doe',
    phone: '021 555 0100',
    email: 'jane.doe@example.org',
    grade: 'Open',
    role: 'member',
    active: true,
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('MembersScreen', () => {
  it('shows an empty state with no members', () => {
    render(<MembersScreen />);
    expect(screen.getByText('No members match.')).toBeTruthy();
  });

  it('lists members sorted by last name with tel:/mailto: links', () => {
    membersFixture = [
      member({ id: 'm1', firstName: 'Zack', lastName: 'Young', phone: '021 555 0102', email: 'zack.young@example.org' }),
      member({ id: 'm2', firstName: 'Jane', lastName: 'Adams', phone: '021 555 0101', email: 'jane.adams@example.org' }),
    ];
    render(<MembersScreen />);
    const rows = screen.getAllByRole('row').slice(1); // drop the header row
    expect(rows[0]!.textContent).toContain('Jane Adams');
    expect(rows[1]!.textContent).toContain('Zack Young');

    const phoneLink = screen.getByRole('link', { name: /Call Jane Adams/ });
    expect(phoneLink.getAttribute('href')).toBe('tel:021 555 0101');
    const emailLink = screen.getByRole('link', { name: /Email Jane Adams/ });
    expect(emailLink.getAttribute('href')).toBe('mailto:jane.adams@example.org');
  });

  it('tolerates a member with no phone or email — renders nothing, not "undefined"', () => {
    const noContact = member({ id: 'm3', firstName: 'No', lastName: 'Contact', phone: '' });
    delete noContact.email;
    membersFixture = [noContact];
    render(<MembersScreen />);
    expect(screen.getByText('No Contact')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Call/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Email/ })).toBeNull();
    expect(screen.queryByText('undefined')).toBeNull();
  });

  it('filters by name, case-insensitively', async () => {
    membersFixture = [
      member({ id: 'm1', firstName: 'Jane', lastName: 'Doe' }),
      member({ id: 'm2', firstName: 'John', lastName: 'Smith' }),
    ];
    const user = userEvent.setup();
    render(<MembersScreen />);
    await user.type(screen.getByLabelText('Search by name'), 'smith');
    expect(screen.queryByText('Jane Doe')).toBeNull();
    expect(screen.getByText('John Smith')).toBeTruthy();
  });

  it('shows a subscription error banner', () => {
    errorFixture = { code: 'permission-denied' };
    render(<MembersScreen />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});

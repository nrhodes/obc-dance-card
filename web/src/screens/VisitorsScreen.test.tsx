import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Visitor } from '@obc/shared';
import { VisitorsScreen } from './VisitorsScreen';

const createVisitorMock = vi.fn();
const updateVisitorMock = vi.fn();
const deleteVisitorMock = vi.fn();

vi.mock('../api', () => ({
  createVisitor: (...args: unknown[]) => createVisitorMock(...args),
  updateVisitor: (...args: unknown[]) => updateVisitorMock(...args),
  deleteVisitor: (...args: unknown[]) => deleteVisitorMock(...args),
}));

let visitorsFixture: Visitor[] = [];
vi.mock('../visitors/useVisitors', () => ({
  useVisitors: () => ({ visitors: visitorsFixture, loading: false }),
}));

afterEach(() => {
  createVisitorMock.mockReset();
  updateVisitorMock.mockReset();
  deleteVisitorMock.mockReset();
  visitorsFixture = [];
});

function visitor(overrides: Partial<Visitor> = {}): Visitor {
  return {
    id: 'v1',
    displayName: 'Bob Visitor',
    createdByMemberId: 'member-a',
    courtesyEmails: false,
    lastUsedAt: '2027-01-01T00:00:00.000Z',
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('VisitorsScreen', () => {
  it('shows an empty state with no visitors', () => {
    render(<VisitorsScreen />);
    expect(screen.getByText("You haven't added any visitors yet.")).toBeTruthy();
  });

  it('lists visitors with a "now a member" badge when promoted', () => {
    visitorsFixture = [visitor({ id: 'v2', displayName: 'Promoted Person', promotedToMemberId: 'member-z' })];
    render(<VisitorsScreen />);
    expect(screen.getByText('Promoted Person')).toBeTruthy();
    expect(screen.getByText('now a member')).toBeTruthy();
  });

  it('adds a visitor and shows the name-collision warning', async () => {
    createVisitorMock.mockResolvedValueOnce({
      visitor: visitor({ displayName: 'Jane Doe' }),
      warnings: ['An active member is also named "Jane Doe" — double check you meant to add a visitor, not invite a member.'],
    });
    const user = userEvent.setup();
    render(<VisitorsScreen />);
    await user.click(screen.getByRole('button', { name: 'Add a visitor' }));
    await user.type(screen.getByLabelText('Name'), 'Jane Doe');
    await user.click(screen.getByRole('button', { name: 'Add visitor' }));
    expect(createVisitorMock).toHaveBeenCalledWith({ displayName: 'Jane Doe', courtesyEmails: false });
    expect(await screen.findByText(/double check you meant to add a visitor/)).toBeTruthy();
  });

  it('enables "Send them a confirmation email" only once an email is entered', async () => {
    const user = userEvent.setup();
    render(<VisitorsScreen />);
    await user.click(screen.getByRole('button', { name: 'Add a visitor' }));
    const checkbox = screen.getByRole('checkbox', { name: /Send them a confirmation email/ }) as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
    await user.type(screen.getByLabelText('Email (optional)'), 'bob@example.org');
    expect(checkbox.disabled).toBe(false);
  });

  it('edits a visitor', async () => {
    visitorsFixture = [visitor()];
    updateVisitorMock.mockResolvedValueOnce({ visitor: visitor({ notes: 'Plays Tuesdays' }) });
    const user = userEvent.setup();
    render(<VisitorsScreen />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByLabelText('Notes (optional)'), 'Plays Tuesdays');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(updateVisitorMock).toHaveBeenCalledWith(
      expect.objectContaining({ visitorId: 'v1', notes: 'Plays Tuesdays' }),
    );
  });

  it('deletes a visitor after confirming', async () => {
    visitorsFixture = [visitor()];
    deleteVisitorMock.mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup();
    render(<VisitorsScreen />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('dialog').querySelector('button.button-danger')!);
    expect(deleteVisitorMock).toHaveBeenCalledWith({ visitorId: 'v1' });
  });

  it('shows the server\'s failed-precondition message verbatim when delete is blocked', async () => {
    visitorsFixture = [visitor()];
    deleteVisitorMock.mockRejectedValueOnce({
      code: 'failed-precondition',
      message: 'This visitor has upcoming, non-cancelled entries — cancel those first.',
    });
    const user = userEvent.setup();
    render(<VisitorsScreen />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('dialog').querySelector('button.button-danger')!);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This visitor has upcoming, non-cancelled entries — cancel those first.',
    );
  });
});

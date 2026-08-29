/**
 * Admin: session edit dialog (plan §9.2 `updateSession`, §9.3, Phase 6b task
 * deliverable 3 + Tests section: "programme edit dialogs").
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Session } from '@obc/shared';
import { SessionEditDialog } from './SessionEditDialog';

const updateSessionMock = vi.fn();
vi.mock('../../api', () => ({
  updateSession: (...args: unknown[]) => updateSessionMock(...args),
}));

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'monday-marion-taylor-pairs-2027-01-11',
    date: '2027-01-11',
    weekday: 'monday',
    seriesId: 'monday-marion-taylor-pairs',
    kind: 'series',
    title: 'Marion Taylor Pairs',
    partnerRequired: true,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

beforeEach(() => {
  updateSessionMock.mockReset();
});

describe('SessionEditDialog', () => {
  it('shows the non-cancelled sign-up count and refuses a date move verbatim', async () => {
    updateSessionMock.mockRejectedValueOnce({
      code: 'failed-precondition',
      message: 'Cancel entries first before moving this session’s date.',
    });
    const user = userEvent.setup();
    render(<SessionEditDialog year={2027} session={session()} activeEntryCount={2} onClose={vi.fn()} onSaved={vi.fn()} onRemoved={vi.fn()} />);

    expect(screen.getByText(/2 non-cancelled sign-ups/)).toBeTruthy();
    const dateInput = screen.getByLabelText('Date');
    await user.clear(dateInput);
    await user.type(dateInput, '2027-01-18');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Cancel entries first before moving this session’s date.')).toBeTruthy();
  });

  it('confirms removal, explains the cascade, and calls updateSession with remove: true', async () => {
    updateSessionMock.mockResolvedValueOnce({ session: null, removed: true });
    const onRemoved = vi.fn();
    const user = userEvent.setup();
    render(<SessionEditDialog year={2027} session={session()} activeEntryCount={3} onClose={vi.fn()} onSaved={vi.fn()} onRemoved={onRemoved} />);

    await user.click(screen.getByRole('button', { name: 'Remove session' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/3 non-cancelled sign-ups will be cancelled/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Remove session' }));

    expect(updateSessionMock).toHaveBeenCalledWith({ year: 2027, sessionId: session().id, patch: { remove: true } });
    expect(onRemoved).toHaveBeenCalled();
  });
});

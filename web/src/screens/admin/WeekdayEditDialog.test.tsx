/**
 * Admin: weekday edit dialog (plan §9.2 `updateWeekday`; backlog gap closed
 * 2026-09-05 — mid-year steward handover without a full CSV re-import).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Member, WeekdayProgramme } from '@obc/shared';
import { WeekdayEditDialog } from './WeekdayEditDialog';

const updateWeekdayMock = vi.fn();
vi.mock('../../api', () => ({
  updateWeekday: (...args: unknown[]) => updateWeekdayMock(...args),
}));

const members: Member[] = [
  { id: 'm-bill', firstName: 'Bill', lastName: 'Anderson', phone: '', grade: 'Open', role: 'member', active: true, createdAt: '', updatedAt: '' },
  { id: 'm-joan', firstName: 'Joan', lastName: 'Zebra', phone: '', grade: 'Open', role: 'member', active: true, createdAt: '', updatedAt: '' },
];

vi.mock('../../members/useMembersDirectory', () => ({
  useMembersDirectory: () => ({
    members,
    byId: new Map(members.map((m) => [m.id, m])),
    nameOf: (id: string) => members.find((m) => m.id === id)?.firstName ?? 'A member',
    loading: false,
    error: null,
  }),
}));

function weekday(overrides: Partial<WeekdayProgramme> = {}): WeekdayProgramme {
  return {
    id: 'monday',
    weekday: 'monday',
    label: 'Monday Afternoon',
    startTime: '13:00',
    seatedByTime: '12:45',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

beforeEach(() => {
  updateWeekdayMock.mockReset();
});

describe('WeekdayEditDialog', () => {
  it('prefills every field from the weekday doc', () => {
    render(
      <WeekdayEditDialog
        year={2027}
        weekday={weekday({ partnerStewardMemberId: 'm-bill', notes: 'Bring your own cards' })}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('Monday Afternoon');
    expect((screen.getByLabelText('Start time') as HTMLInputElement).value).toBe('13:00');
    expect((screen.getByLabelText('Seated by') as HTMLInputElement).value).toBe('12:45');
    expect((screen.getByLabelText('Partner steward') as HTMLSelectElement).value).toBe('m-bill');
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('Bring your own cards');
  });

  it('the steward select offers a None option plus active members sorted by last name', () => {
    render(<WeekdayEditDialog year={2027} weekday={weekday()} onClose={vi.fn()} onSaved={vi.fn()} />);

    const options = screen.getAllByRole<HTMLOptionElement>('option');
    expect(options.map((o) => o.textContent)).toEqual(['None', 'Anderson, Bill', 'Zebra, Joan']);
  });

  it('sends only the changed fields, and reports success', async () => {
    updateWeekdayMock.mockResolvedValueOnce({ weekday: weekday({ label: 'Monday Social' }) });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<WeekdayEditDialog year={2027} weekday={weekday()} onClose={vi.fn()} onSaved={onSaved} />);

    const labelInput = screen.getByLabelText('Label');
    await user.clear(labelInput);
    await user.type(labelInput, 'Monday Social');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(updateWeekdayMock).toHaveBeenCalledWith({
      year: 2027,
      weekday: 'monday',
      patch: { label: 'Monday Social' },
    });
    expect(onSaved).toHaveBeenCalledWith('Monday Social updated.');
  });

  it('clears the steward by selecting None, sending an explicit null', async () => {
    updateWeekdayMock.mockResolvedValueOnce({ weekday: weekday() });
    const user = userEvent.setup();
    render(
      <WeekdayEditDialog
        year={2027}
        weekday={weekday({ partnerStewardMemberId: 'm-bill' })}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText('Partner steward'), 'None');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(updateWeekdayMock).toHaveBeenCalledWith({
      year: 2027,
      weekday: 'monday',
      patch: { partnerStewardMemberId: null },
    });
  });

  it('shows a failed-precondition error verbatim', async () => {
    updateWeekdayMock.mockRejectedValueOnce({
      code: 'failed-precondition',
      message: 'That member is not available as a partner steward.',
    });
    const user = userEvent.setup();
    render(
      <WeekdayEditDialog
        year={2027}
        weekday={weekday()}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText('Partner steward'), 'm-bill');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('That member is not available as a partner steward.')).toBeTruthy();
  });
});

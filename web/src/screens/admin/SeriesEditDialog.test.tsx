/**
 * Admin: series edit dialog (plan §9.2 `updateSeries`, Phase 6b task
 * deliverable 3 + Tests section: "programme edit dialogs").
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Series } from '@obc/shared';
import { SeriesEditDialog } from './SeriesEditDialog';

const updateSeriesMock = vi.fn();
vi.mock('../../api', () => ({
  updateSeries: (...args: unknown[]) => updateSeriesMock(...args),
}));

function series(overrides: Partial<Series> = {}): Series {
  return {
    id: 'monday-marion-taylor-pairs',
    weekday: 'monday',
    name: 'Marion Taylor Pairs',
    scoring: 'Scr',
    format: 'Pairs',
    bestOf: null,
    allowSubstitute: true,
    order: 0,
    sessionIds: ['s1'],
    teamMin: 4,
    teamMax: 6,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

beforeEach(() => {
  updateSeriesMock.mockReset();
});

describe('SeriesEditDialog', () => {
  it('submits a name change via updateSeries and reports success', async () => {
    updateSeriesMock.mockResolvedValueOnce({ series: series({ name: 'New Name' }) });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<SeriesEditDialog year={2027} series={series()} onClose={vi.fn()} onSaved={onSaved} />);

    const nameInput = screen.getByLabelText('Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'New Name');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(updateSeriesMock).toHaveBeenCalledWith(
      expect.objectContaining({ year: 2027, seriesId: 'monday-marion-taylor-pairs', patch: expect.objectContaining({ name: 'New Name' }) }),
    );
    expect(onSaved).toHaveBeenCalledWith('New Name updated.');
  });

  it('shows the "format change refused" failed-precondition error verbatim', async () => {
    updateSeriesMock.mockRejectedValueOnce({
      code: 'failed-precondition',
      message: 'Cannot change this series’ format while it has non-cancelled entries. Cancel them first.',
    });
    const user = userEvent.setup();
    render(<SeriesEditDialog year={2027} series={series()} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('Format'), 'Teams');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Cannot change this series’ format while it has non-cancelled entries. Cancel them first.')).toBeTruthy();
  });
});

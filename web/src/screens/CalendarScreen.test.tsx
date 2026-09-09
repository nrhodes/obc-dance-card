import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry, Series, Session } from '@obc/shared';
import type { ProgrammeContextValue } from '../programme/ProgrammeContext';
import { CalendarScreen } from './CalendarScreen';

const useProgrammeMock = vi.fn<() => ProgrammeContextValue>();
const useMyEntriesMock = vi.fn<() => { entries: Entry[]; loading: boolean; error: { code: string } | null }>();
const useEffectiveMemberMock = vi.fn<() => { effectiveMemberId: string | null; onBehalfOfMemberId: string | undefined; actingAsName: string | null }>();
const setBulkSoloStatusMock = vi.fn();

vi.mock('../programme/useProgramme', () => ({
  useProgramme: () => useProgrammeMock(),
}));

vi.mock('../entries/useMyEntries', () => ({
  useMyEntries: () => useMyEntriesMock(),
}));

vi.mock('../admin/useEffectiveMember', () => ({
  useEffectiveMember: () => useEffectiveMemberMock(),
}));

vi.mock('../api', () => ({
  setBulkSoloStatus: (input: unknown) => setBulkSoloStatusMock(input),
}));

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'monday-pairs-2027-01-11',
    date: '2027-01-11', // Monday
    weekday: 'monday',
    seriesId: 'monday-pairs',
    kind: 'series',
    title: 'Monday Pairs',
    partnerRequired: true,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'e1',
    sessionId: 'monday-pairs-2027-01-11',
    date: '2027-01-11',
    weekday: 'monday',
    seriesId: 'monday-pairs',
    memberId: 'member-a',
    cohort: 'club',
    status: 'confirmed',
    partner: null,
    pairingId: null,
    teamId: null,
    teamSessionOnly: false,
    substitute: null,
    partnerSubstitute: null,
    isSubstituteFor: null,
    createdBy: 'member-a',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function seriesFixture(overrides: Partial<Series> = {}): Series {
  return {
    id: 'monday-pairs',
    weekday: 'monday',
    name: 'Monday Pairs',
    scoring: 'Scr',
    format: 'Pairs',
    bestOf: null,
    allowSubstitute: true,
    order: 0,
    sessionIds: [],
    teamMin: 4,
    teamMax: 6,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function programmeValue(sessions: Session[], series: Series[] = []): ProgrammeContextValue {
  return {
    loading: false,
    error: null,
    years: [2027],
    byYear: [],
    weekdays: [],
    series: series.map((s) => ({ ...s, year: 2027 })),
    sessions: sessions.map((s) => ({ ...s, year: 2027 })),
    year: 2027,
    programme: { id: '2027', year: 2027, status: 'published', createdAt: '', updatedAt: '' },
  };
}

function setup({ sessions, entries, series }: { sessions?: Session[]; entries?: Entry[]; series?: Series[] } = {}): void {
  useProgrammeMock.mockReturnValue(programmeValue(sessions ?? [session()], series));
  useMyEntriesMock.mockReturnValue({ entries: entries ?? [], loading: false, error: null });
  useEffectiveMemberMock.mockReturnValue({ effectiveMemberId: 'member-a', onBehalfOfMemberId: undefined, actingAsName: null });
}

function renderScreen() {
  return render(
    <MemoryRouter>
      <CalendarScreen />
    </MemoryRouter>,
  );
}

describe('CalendarScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2027-01-11T09:00:00+13:00')); // Monday, NZDT
    setBulkSoloStatusMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to List mode and shows a booked session with its status', () => {
    setup({ entries: [entry({ status: 'confirmed' })] });
    renderScreen();

    expect(screen.getByRole('tab', { name: 'List' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('link', { name: 'Monday Pairs' })).toBeTruthy();
    expect(screen.getByText('Booked')).toBeTruthy();
  });

  it('shows an open session as such when the member has no entry', () => {
    setup({ entries: [] });
    renderScreen();
    expect(screen.getByText(/Open/)).toBeTruthy();
  });

  it('switches to Month mode and shows the current month grid', async () => {
    setup();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderScreen();

    await user.click(screen.getByRole('tab', { name: 'Month' }));
    expect(screen.getByRole('heading', { name: 'January 2027' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Month' }).getAttribute('aria-selected')).toBe('true');
  });

  it('Month mode fuses a series run into one slab, breaks between series, and shows the series key + names in cell labels', async () => {
    setup({
      sessions: [
        session({ id: 's-jan-11', date: '2027-01-11', seriesId: 'monday-pairs', title: 'Monday Pairs' }),
        session({ id: 's-jan-18', date: '2027-01-18', seriesId: 'monday-pairs', title: 'Monday Pairs' }),
        session({ id: 's-jan-25', date: '2027-01-25', seriesId: 'campbell', title: 'Campbell Cave Pairs' }),
        session({ id: 's-jan-04', date: '2027-01-04', seriesId: null, kind: 'holidayBridge', title: 'Holiday Bridge' }),
      ],
      series: [
        seriesFixture({ id: 'monday-pairs', name: 'Monday Pairs', order: 0 }),
        seriesFixture({ id: 'campbell', name: 'Campbell Cave Pairs', order: 1 }),
      ],
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderScreen();

    await user.click(screen.getByRole('tab', { name: 'Month' }));

    // Jan 11 is `monday-pairs`' true first session (`start`): it squares its
    // bottom corners and renders a connector bridging into Jan 18. Jan 18 is
    // its true last session (`end`): it squares its top corners (fusing up
    // to Jan 11) and renders no connector below (nothing continues). Jan 25
    // is `campbell`'s only session (`solo`): no fusion classes, no connector.
    const mondayStartCell = screen.getByRole('button', { name: /Mon 11 Jan 2027.*Monday Pairs/ });
    expect(mondayStartCell.className).toContain('month-cell-fused-bottom');
    expect(mondayStartCell.className).not.toContain('month-cell-fused-top');
    expect(mondayStartCell.querySelector('.month-cell-connector')).not.toBeNull();

    const mondayEndCell = screen.getByRole('button', { name: /Mon 18 Jan 2027.*Monday Pairs/ });
    expect(mondayEndCell.className).toContain('month-cell-fused-top');
    expect(mondayEndCell.className).not.toContain('month-cell-fused-bottom');
    expect(mondayEndCell.querySelector('.month-cell-connector')).toBeNull();

    const campbellCell = screen.getByRole('button', { name: /Mon 25 Jan 2027.*Campbell Cave Pairs/ });
    expect(campbellCell.className).not.toContain('month-cell-fused-top');
    expect(campbellCell.className).not.toContain('month-cell-fused-bottom');
    expect(campbellCell.querySelector('.month-cell-connector')).toBeNull();

    // A one-off (seriesId null) day gets no fusion classes, no connector, and no series name.
    const holidayCell = screen.getByRole('button', { name: /Mon 4 Jan 2027/ });
    expect(holidayCell.className).not.toContain('month-cell-fused-top');
    expect(holidayCell.className).not.toContain('month-cell-fused-bottom');
    expect(holidayCell.querySelector('.month-cell-connector')).toBeNull();
    expect(holidayCell.getAttribute('aria-label')).not.toMatch(/Monday Pairs|Campbell/);

    // The Month key lists each series, first-date order, with its dates that month.
    expect(screen.getByRole('heading', { name: 'Series this month' })).toBeTruthy();
    expect(screen.getByText('Monday Pairs — 11, 18 Jan')).toBeTruthy();
    expect(screen.getByText('Campbell Cave Pairs — 25 Jan')).toBeTruthy();
  });

  it('Month mode omits the series key when the month has no series sessions', async () => {
    setup({ sessions: [session({ seriesId: null, kind: 'holidayBridge', title: 'Holiday Bridge' })] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderScreen();

    await user.click(screen.getByRole('tab', { name: 'Month' }));
    expect(screen.queryByRole('heading', { name: 'Series this month' })).toBeNull();
  });

  it('switches to Year mode and shows a year picker with the loaded year', async () => {
    setup();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderScreen();

    await user.click(screen.getByRole('tab', { name: 'Year' }));
    // `{ selector: 'select' }` avoids also matching the Year tabpanel `<div>`,
    // which is `aria-labelledby` the "Year" tab button and so is *also*
    // "labelled" Year by the same broad `getByLabelText` algorithm.
    const picker = screen.getByLabelText('Year', { selector: 'select' }) as HTMLSelectElement;
    expect(picker.value).toBe('2027');
    expect(within(picker).getByRole('option', { name: '2027' })).toBeTruthy();
  });

  describe('Set availability… dialog', () => {
    it('shows a live preview and confirms with the right payload', async () => {
      setup({ entries: [] });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderScreen();

      await user.click(screen.getByRole('button', { name: 'Set availability…' }));
      expect(screen.getByRole('dialog')).toBeTruthy();

      // No weekday chosen yet.
      expect(screen.getByText('Choose at least one weekday to see a preview.')).toBeTruthy();

      await user.click(screen.getByRole('radio', { name: /Unavailable/ }));
      await user.click(screen.getByRole('checkbox', { name: 'Monday' }));

      expect(screen.getByText(/This will mark about 1 session/)).toBeTruthy();

      setBulkSoloStatusMock.mockResolvedValue({ updated: 1, skipped: [] });
      await user.click(screen.getByRole('button', { name: 'Confirm' }));

      expect(setBulkSoloStatusMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'unavailable',
          filter: expect.objectContaining({ weekdays: ['monday'], fromDate: '2027-01-11' }),
        }),
      );
      expect(await screen.findByText(/Marked 1 session as unavailable\./)).toBeTruthy();
    });

    it('reports skipped booked sessions in the success summary', async () => {
      setup({ entries: [entry({ status: 'confirmed' })] });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderScreen();

      await user.click(screen.getByRole('button', { name: 'Set availability…' }));
      await user.click(screen.getByRole('checkbox', { name: 'Monday' }));

      setBulkSoloStatusMock.mockResolvedValue({ updated: 0, skipped: [{ sessionId: 'monday-pairs-2027-01-11', date: '2027-01-11', reason: 'booked' }] });
      await user.click(screen.getByRole('button', { name: 'Confirm' }));

      expect(await screen.findByText(/Kept your bookings on:/)).toBeTruthy();
    });
  });
});

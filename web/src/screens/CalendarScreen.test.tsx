import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry, Session } from '@obc/shared';
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

function programmeValue(sessions: Session[]): ProgrammeContextValue {
  return {
    loading: false,
    error: null,
    years: [2027],
    byYear: [],
    weekdays: [],
    series: [],
    sessions: sessions.map((s) => ({ ...s, year: 2027 })),
    year: 2027,
    programme: { id: '2027', year: 2027, status: 'published', createdAt: '', updatedAt: '' },
  };
}

function setup({ sessions, entries }: { sessions?: Session[]; entries?: Entry[] } = {}): void {
  useProgrammeMock.mockReturnValue(programmeValue(sessions ?? [session()]));
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

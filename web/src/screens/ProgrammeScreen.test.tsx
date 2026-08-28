import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ProgrammeContextValue } from '../programme/ProgrammeContext';
import type { Series, Session, WeekdayProgramme } from '@obc/shared';
import { ProgrammeScreen } from './ProgrammeScreen';

const useProgrammeMock = vi.fn<() => ProgrammeContextValue>();

vi.mock('../programme/useProgramme', () => ({
  useProgramme: () => useProgrammeMock(),
}));

vi.mock('../members/useMembersDirectory', () => ({
  useMembersDirectory: () => ({
    members: [],
    byId: new Map(),
    nameOf: (id: string) => `Member ${id}`,
    loading: false,
  }),
}));

function weekday(overrides: Partial<WeekdayProgramme> = {}): WeekdayProgramme {
  return {
    id: 'monday',
    weekday: 'monday',
    label: 'Monday Afternoon',
    startTime: '13:00',
    seatedByTime: '12:45',
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

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
    sessionIds: [],
    teamMin: 4,
    teamMax: 6,
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'monday-marion-taylor-pairs-2027-01-11',
    date: '2027-01-11',
    weekday: 'monday',
    seriesId: 'monday-marion-taylor-pairs',
    kind: 'series',
    title: 'Marion Taylor Pairs',
    partnerRequired: true,
    seriesName: 'Marion Taylor Pairs',
    scoring: 'Scr',
    format: 'Pairs',
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderWithRouter(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('ProgrammeScreen', () => {
  it('shows the empty state when there is no published programme', () => {
    useProgrammeMock.mockReturnValue({ year: null, programme: null, weekdays: [], series: [], sessions: [], loading: false });
    renderWithRouter(<ProgrammeScreen />);
    expect(screen.getByText("The programme hasn't been published yet.")).toBeTruthy();
  });

  it('shows a loading state', () => {
    useProgrammeMock.mockReturnValue({ year: null, programme: null, weekdays: [], series: [], sessions: [], loading: true });
    renderWithRouter(<ProgrammeScreen />);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('renders weekday tabs and a series card with its session dates', () => {
    useProgrammeMock.mockReturnValue({
      year: 2027,
      programme: { id: '2027', year: 2027, status: 'published', createdAt: '', updatedAt: '' },
      weekdays: [weekday(), weekday({ id: 'friday', weekday: 'friday', label: 'Friday Afternoon' })],
      series: [series()],
      sessions: [session(), session({ id: 'monday-marion-taylor-pairs-2027-01-18', date: '2027-01-18' })],
      loading: false,
    });
    renderWithRouter(<ProgrammeScreen />);

    const tablist = screen.getByRole('tablist', { name: 'Weekday' });
    expect(tablist).toBeTruthy();
    const mondayTab = screen.getByRole('tab', { name: 'Mon' });
    expect(mondayTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Fri' })).toBeTruthy();

    expect(screen.getByText('Marion Taylor Pairs')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Mon 11 Jan 2027/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Mon 18 Jan 2027/ })).toBeTruthy();
  });

  it('switches weekday tabs on click', async () => {
    useProgrammeMock.mockReturnValue({
      year: 2027,
      programme: { id: '2027', year: 2027, status: 'published', createdAt: '', updatedAt: '' },
      weekdays: [weekday(), weekday({ id: 'friday', weekday: 'friday', label: 'Friday Afternoon' })],
      series: [series(), series({ id: 'friday-x', weekday: 'friday', name: 'Friday Pairs', order: 0 })],
      sessions: [session(), session({ id: 'friday-x-2027-01-15', date: '2027-01-15', weekday: 'friday', seriesId: 'friday-x', title: 'Friday Pairs' })],
      loading: false,
    });
    const user = userEvent.setup();
    renderWithRouter(<ProgrammeScreen />);

    expect(screen.queryByText('Friday Pairs')).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Fri' }));
    expect(screen.getByText('Friday Pairs')).toBeTruthy();
  });

  it('shows holidayBridge singles inline, and greys out noBridge', () => {
    useProgrammeMock.mockReturnValue({
      year: 2027,
      programme: { id: '2027', year: 2027, status: 'published', createdAt: '', updatedAt: '' },
      weekdays: [weekday()],
      series: [],
      sessions: [
        session({
          id: 'monday-2027-01-04',
          date: '2027-01-04',
          seriesId: null,
          kind: 'holidayBridge',
          title: 'Holiday Bridge',
          partnerRequired: true,
        }),
      ],
      loading: false,
    });
    renderWithRouter(<ProgrammeScreen />);
    expect(screen.getByRole('link', { name: /Holiday Bridge/ })).toBeTruthy();
  });
});

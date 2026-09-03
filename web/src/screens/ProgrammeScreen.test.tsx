import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgrammeContextValue, ProgrammeYearData } from '../programme/ProgrammeContext';
import type { Programme, Series, Session, WeekdayProgramme } from '@obc/shared';
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

function programmeDoc(year: number): Programme {
  return { id: String(year), year, status: 'published', createdAt: '', updatedAt: '' };
}

/**
 * Builds a `ProgrammeContextValue` for a set of years, newest first — mirrors
 * `ProgrammeProvider`'s merged, year-tagged shape (plan §21 B3) so tests
 * don't have to hand-roll the tagging every time.
 */
function mockContext(
  years: Array<{ year: number; weekdays?: WeekdayProgramme[]; series?: Series[]; sessions?: Session[] }>,
  overrides: Partial<ProgrammeContextValue> = {},
): ProgrammeContextValue {
  const sortedYears = [...years].sort((a, b) => b.year - a.year);
  const byYear: ProgrammeYearData[] = sortedYears.map((y) => ({
    year: y.year,
    programme: programmeDoc(y.year),
    weekdays: y.weekdays ?? [],
    series: y.series ?? [],
    sessions: y.sessions ?? [],
  }));
  return {
    loading: false,
    error: null,
    years: sortedYears.map((y) => y.year),
    byYear,
    weekdays: byYear.flatMap((yd) => yd.weekdays.map((w) => ({ ...w, year: yd.year }))),
    series: byYear.flatMap((yd) => yd.series.map((s) => ({ ...s, year: yd.year }))),
    sessions: byYear.flatMap((yd) => yd.sessions.map((s) => ({ ...s, year: yd.year }))),
    year: sortedYears[0]?.year ?? null,
    programme: sortedYears[0] ? programmeDoc(sortedYears[0].year) : null,
    ...overrides,
  };
}

function renderWithRouter(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('ProgrammeScreen', () => {
  // The screen opens on *today's* weekday (`defaultProgrammeWeekday`), so
  // without a fixed clock these tests quietly depend on the day CI runs:
  // the mock programme below runs Monday and Friday, and on a Friday it is
  // the Friday tab that comes up selected, not Monday. That failed `main`
  // once a week and passed the other six days.
  //
  // Freezing to a known Monday also makes the assertions mean what they say
  // — "the current weekday is preselected" — rather than passing by accident
  // because today happened not to be in the programme at all.
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2027-01-11T09:00:00+13:00')); // Monday, NZDT
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the empty state when there is no published programme', () => {
    useProgrammeMock.mockReturnValue(mockContext([]));
    renderWithRouter(<ProgrammeScreen />);
    expect(screen.getByText("The programme hasn't been published yet.")).toBeTruthy();
  });

  it('shows a loading state', () => {
    useProgrammeMock.mockReturnValue(mockContext([], { loading: true }));
    renderWithRouter(<ProgrammeScreen />);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('renders weekday tabs and a series card with its session dates', async () => {
    useProgrammeMock.mockReturnValue(
      mockContext([
        {
          year: 2027,
          weekdays: [weekday(), weekday({ id: 'friday', weekday: 'friday', label: 'Friday Afternoon' })],
          series: [series()],
          sessions: [session(), session({ id: 'monday-marion-taylor-pairs-2027-01-18', date: '2027-01-18' })],
        },
      ]),
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithRouter(<ProgrammeScreen />);

    const tablist = screen.getByRole('tablist', { name: 'Weekday' });
    expect(tablist).toBeTruthy();
    // The initial tab defaults to *today's* real weekday (Mon-Fri) — select
    // Monday explicitly rather than assume it's already selected, so this
    // test doesn't depend on which real-world weekday it happens to run on.
    const mondayTab = screen.getByRole('tab', { name: 'Mon' });
    await user.click(mondayTab);
    expect(mondayTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Fri' })).toBeTruthy();

    expect(screen.getByRole('heading', { name: '2027 Programme' })).toBeTruthy();
    expect(screen.getByText('Marion Taylor Pairs')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Mon 11 Jan 2027/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Mon 18 Jan 2027/ })).toBeTruthy();
  });

  it('shows a heading spanning every loaded year', () => {
    useProgrammeMock.mockReturnValue(
      mockContext([
        { year: 2027, weekdays: [weekday()], series: [], sessions: [] },
        { year: 2026, weekdays: [weekday()], series: [], sessions: [] },
      ]),
    );
    renderWithRouter(<ProgrammeScreen />);
    expect(screen.getByRole('heading', { name: '2026 & 2027 Programme' })).toBeTruthy();
  });

  it('switches weekday tabs on click', async () => {
    useProgrammeMock.mockReturnValue(
      mockContext([
        {
          year: 2027,
          weekdays: [weekday(), weekday({ id: 'friday', weekday: 'friday', label: 'Friday Afternoon' })],
          series: [series(), series({ id: 'friday-x', weekday: 'friday', name: 'Friday Pairs', order: 0 })],
          sessions: [session(), session({ id: 'friday-x-2027-01-15', date: '2027-01-15', weekday: 'friday', seriesId: 'friday-x', title: 'Friday Pairs' })],
        },
      ]),
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithRouter(<ProgrammeScreen />);

    // See the previous test's comment: the initial tab defaults to today's
    // real weekday, so select Monday explicitly first rather than assume
    // it's already the active tab.
    await user.click(screen.getByRole('tab', { name: 'Mon' }));
    expect(screen.queryByText('Friday Pairs')).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Fri' }));
    expect(screen.getByText('Friday Pairs')).toBeTruthy();
  });

  it('shows holidayBridge singles inline, and greys out noBridge', () => {
    useProgrammeMock.mockReturnValue(
      mockContext([
        {
          year: 2027,
          weekdays: [weekday()],
          series: [],
          sessions: [
            session({
              // A *future* Monday relative to the frozen clock (2027-01-11):
              // a past single would be hidden by the past-hiding default.
              id: 'monday-2027-01-18',
              date: '2027-01-18',
              seriesId: null,
              kind: 'holidayBridge',
              title: 'Holiday Bridge',
              partnerRequired: true,
            }),
          ],
        },
      ]),
    );
    renderWithRouter(<ProgrammeScreen />);
    expect(screen.getByRole('link', { name: /Holiday Bridge/ })).toBeTruthy();
  });

  describe('past-hiding (plan §21 B3)', () => {
    const PAST_DATE = '2020-01-06'; // a Monday, safely before any real "today"
    const FUTURE_DATE = '2099-01-05'; // a Monday, safely after any real "today"

    it('hides a past standalone session by default, and reveals it via the toggle', async () => {
      useProgrammeMock.mockReturnValue(
        mockContext([
          {
            year: 2027,
            weekdays: [weekday()],
            series: [],
            sessions: [
              session({ id: 'past-single', date: PAST_DATE, seriesId: null, kind: 'holidayBridge', title: 'Old Holiday Bridge' }),
              session({ id: 'future-single', date: FUTURE_DATE, seriesId: null, kind: 'holidayBridge', title: 'Future Holiday Bridge' }),
            ],
          },
        ]),
      );
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderWithRouter(<ProgrammeScreen />);

      expect(screen.getByText(/Future Holiday Bridge/)).toBeTruthy();
      expect(screen.queryByText(/Old Holiday Bridge/)).toBeNull();

      await user.click(screen.getByRole('button', { name: 'Show earlier sessions' }));
      expect(screen.getByText(/Old Holiday Bridge/)).toBeTruthy();

      await user.click(screen.getByRole('button', { name: 'Hide earlier sessions' }));
      expect(screen.queryByText(/Old Holiday Bridge/)).toBeNull();
    });

    it('hides a fully-past series by default, and reveals it via the toggle', async () => {
      useProgrammeMock.mockReturnValue(
        mockContext([
          {
            year: 2027,
            weekdays: [weekday()],
            series: [series({ id: 'old-series', name: 'Old Series' })],
            sessions: [session({ id: 'old-series-1', date: PAST_DATE, seriesId: 'old-series', title: 'Old Series' })],
          },
        ]),
      );
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderWithRouter(<ProgrammeScreen />);

      expect(screen.queryByText('Old Series')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Show earlier sessions' }));
      expect(screen.getByText('Old Series')).toBeTruthy();
    });

    it('always shows a partially-past series, with every date (past and future) listed', () => {
      useProgrammeMock.mockReturnValue(
        mockContext([
          {
            year: 2027,
            weekdays: [weekday()],
            series: [series()],
            sessions: [
              session({ id: 'monday-marion-taylor-pairs-past', date: PAST_DATE }),
              session({ id: 'monday-marion-taylor-pairs-future', date: FUTURE_DATE }),
            ],
          },
        ]),
      );
      renderWithRouter(<ProgrammeScreen />);

      expect(screen.getByText('Marion Taylor Pairs')).toBeTruthy();
      const pastLink = screen.getByRole('link', { name: /6 Jan 2020/ });
      const futureLink = screen.getByRole('link', { name: /5 Jan 2099/ });
      expect(pastLink).toBeTruthy();
      expect(futureLink).toBeTruthy();
      expect(pastLink.className).toContain('session-past');
      expect(futureLink.className).not.toContain('session-past');
    });

    it('omits the toggle entirely when the weekday has nothing hidden (no dead button)', () => {
      useProgrammeMock.mockReturnValue(
        mockContext([
          {
            year: 2027,
            weekdays: [weekday()],
            // A partially-past series is always visible, so nothing is hidden
            // by default — the toggle must not render as a do-nothing button.
            series: [series()],
            sessions: [
              session({ id: 'monday-marion-taylor-pairs-past', date: PAST_DATE }),
              session({ id: 'monday-marion-taylor-pairs-future', date: FUTURE_DATE }),
            ],
          },
        ]),
      );
      renderWithRouter(<ProgrammeScreen />);

      expect(screen.queryByRole('button', { name: /earlier sessions/ })).toBeNull();
    });
  });
});

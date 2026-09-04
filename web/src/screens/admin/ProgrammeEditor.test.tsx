/**
 * Admin: Programme editor (plan §9.2 `updateSeries`/`updateSession`, §21 B5
 * "Admin: sign-up counts per event"). Covers the sign-up summary strings per
 * session, the series-header roll-up visible when collapsed, the "One-off
 * sessions" card (including the noBridge "—" case), and that
 * `SessionEditDialog` still gets the right `activeEntryCount`.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Entry, Programme, Series, Session } from '@obc/shared';
import { ProgrammeEditor } from './ProgrammeEditor';

let programmesFixture: Programme[] = [];
let seriesFixture: Series[] = [];
let sessionsFixture: Session[] = [];
let entriesFixture: Entry[] = [];

vi.mock('../../firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ({ __path: path }),
  query: (base: { __path: string }, ..._rest: unknown[]) => base,
  where: () => ({}),
  orderBy: () => ({}),
  onSnapshot: (
    ref: { __path: string },
    onNext: (snap: { docs: Array<{ data: () => unknown }> }) => void,
  ) => {
    const path = ref.__path;
    if (path === 'programmes') {
      onNext({ docs: programmesFixture.map((p) => ({ data: () => p })) });
    } else if (path === 'entries') {
      onNext({ docs: entriesFixture.map((e) => ({ data: () => e })) });
    } else if (path.endsWith('/series')) {
      onNext({ docs: seriesFixture.map((s) => ({ data: () => s })) });
    } else if (path.endsWith('/sessions')) {
      onNext({ docs: sessionsFixture.map((s) => ({ data: () => s })) });
    }
    return () => {};
  },
}));

const updateSeriesMock = vi.fn();
const updateSessionMock = vi.fn();
vi.mock('../../api', () => ({
  updateSeries: (...args: unknown[]) => updateSeriesMock(...args),
  updateSession: (...args: unknown[]) => updateSessionMock(...args),
}));

function programme(overrides: Partial<Programme> = {}): Programme {
  return { id: '2027', year: 2027, status: 'published', createdAt: '', updatedAt: '', ...overrides };
}

function series(overrides: Partial<Series> = {}): Series {
  return {
    id: 'monday-pairs',
    weekday: 'monday',
    name: 'Monday Pairs',
    scoring: 'Scr',
    format: 'Pairs',
    bestOf: null,
    allowSubstitute: true,
    order: 0,
    sessionIds: ['s1', 's2'],
    teamMin: 4,
    teamMax: 6,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    date: '2027-01-11',
    weekday: 'monday',
    seriesId: 'monday-pairs',
    kind: 'series',
    title: 'Monday Pairs',
    partnerRequired: true,
    seriesName: 'Monday Pairs',
    format: 'Pairs',
    scoring: 'Scr',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

/** A standalone (`seriesId: null`) session — holidayBridge/noBridge never denormalise format/scoring/seriesName. */
function standaloneSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'holiday-1',
    date: '2027-02-01',
    weekday: 'monday',
    seriesId: null,
    kind: 'holidayBridge',
    title: 'Holiday Bridge',
    partnerRequired: true,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'e1',
    sessionId: 's1',
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

beforeEach(() => {
  updateSeriesMock.mockReset();
  updateSessionMock.mockReset();
  programmesFixture = [];
  seriesFixture = [];
  sessionsFixture = [];
  entriesFixture = [];
});

describe('ProgrammeEditor', () => {
  it('shows a sign-up summary per session and a series-header roll-up visible while collapsed', async () => {
    programmesFixture = [programme()];
    seriesFixture = [series()];
    sessionsFixture = [
      session({ id: 's1', date: '2027-01-11' }),
      session({ id: 's2', date: '2027-01-18' }),
    ];
    entriesFixture = [
      // s1: one pair (2 entries, 1 pairingId) + one looking.
      entry({ id: 'e1', sessionId: 's1', memberId: 'm1', pairingId: 'p1' }),
      entry({ id: 'e2', sessionId: 's1', memberId: 'm2', pairingId: 'p1' }),
      entry({ id: 'e3', sessionId: 's1', memberId: 'm3', status: 'looking_for_partner' }),
      // s2: no sign-ups.
    ];
    const user = userEvent.setup();
    render(<ProgrammeEditor />);

    // Roll-up visible on the series header without expanding.
    expect(screen.getByText('pair 0–1 across 2 sessions')).toBeTruthy();
    expect(screen.queryByText('1 pair · 1 looking')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Monday Pairs \(Pairs, Scr\)/ }));

    expect(screen.getByText('1 pair · 1 looking')).toBeTruthy();
    expect(screen.getByText('No sign-ups yet')).toBeTruthy();
  });

  it('lists one-off sessions with counts, showing "—" for a noBridge session', async () => {
    programmesFixture = [programme()];
    seriesFixture = [];
    sessionsFixture = [
      standaloneSession({
        id: 'holiday-1',
        kind: 'holidayBridge',
        title: 'Holiday Bridge',
        date: '2027-02-01',
        weekday: 'monday',
      }),
      standaloneSession({
        id: 'nobridge-1',
        kind: 'noBridge',
        title: 'Waitangi Day',
        date: '2027-02-06',
        weekday: 'friday',
        partnerRequired: false,
      }),
    ];
    entriesFixture = [entry({ id: 'e1', sessionId: 'holiday-1', memberId: 'm1', pairingId: 'p1' })];

    render(<ProgrammeEditor />);

    expect(screen.getByText('One-off sessions')).toBeTruthy();
    const oneOffCard = screen.getByText('One-off sessions').closest('div') as HTMLElement;
    expect(within(oneOffCard).getByText('Holiday Bridge')).toBeTruthy();
    expect(within(oneOffCard).getByText('1 pair')).toBeTruthy();
    expect(within(oneOffCard).getByText('Waitangi Day')).toBeTruthy();
    expect(within(oneOffCard).getByText('—')).toBeTruthy();
  });

  it('passes SessionEditDialog the correct activeEntryCount', async () => {
    programmesFixture = [programme()];
    seriesFixture = [series({ sessionIds: ['s1'] })];
    sessionsFixture = [session({ id: 's1', date: '2027-01-11' })];
    entriesFixture = [
      entry({ id: 'e1', sessionId: 's1', memberId: 'm1', pairingId: 'p1' }),
      entry({ id: 'e2', sessionId: 's1', memberId: 'm2', pairingId: 'p1' }),
      entry({ id: 'e3', sessionId: 's1', memberId: 'm3', status: 'looking_for_partner' }),
      entry({ id: 'e4', sessionId: 's1', memberId: 'm4', status: 'cancelled' }),
    ];
    const user = userEvent.setup();
    render(<ProgrammeEditor />);

    await user.click(screen.getByRole('button', { name: /Monday Pairs \(Pairs, Scr\)/ }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(await screen.findByText(/3 non-cancelled sign-ups/)).toBeTruthy();
  });
});

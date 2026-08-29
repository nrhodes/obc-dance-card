import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Entry, Member, Series, Session, Team, WeekdayProgramme } from '@obc/shared';
import type { ProgrammeContextValue } from '../programme/ProgrammeContext';
import { HomeScreen } from './HomeScreen';

const useProgrammeMock = vi.fn<() => ProgrammeContextValue>();
const useAuthMock = vi.fn<() => { member: Member | null }>();

let entriesFixture: Entry[] = [];
let teamsFixture: Team[] = [];

vi.mock('../programme/useProgramme', () => ({
  useProgramme: () => useProgrammeMock(),
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => useAuthMock(),
}));

// No admin acting-as in these tests — the effective member is always the
// signed-in member (mirrors `ActingAsProvider`'s behaviour with nothing set).
vi.mock('../admin/useEffectiveMember', () => ({
  useEffectiveMember: () => ({
    effectiveMemberId: useAuthMock().member?.id ?? null,
    onBehalfOfMemberId: undefined,
    actingAsName: null,
  }),
}));

vi.mock('../firebase', () => ({ db: {} }));

interface FakeQuery {
  collectionPath: string;
}

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string): FakeQuery => ({ collectionPath: path }),
  query: (base: FakeQuery, ..._constraints: unknown[]) => base,
  where: () => ({}),
  orderBy: () => ({}),
  documentId: () => ({}),
  onSnapshot: (q: FakeQuery, onNext: (snap: { docs: Array<{ data: () => unknown }> }) => void) => {
    const docs = q.collectionPath === 'entries' ? entriesFixture : q.collectionPath === 'teams' ? teamsFixture : [];
    onNext({ docs: docs.map((d) => ({ data: () => d })) });
    return () => {};
  },
}));

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: 'member-a',
    firstName: 'Jane',
    lastName: 'Doe',
    phone: '',
    grade: 'Open',
    role: 'member',
    active: true,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

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
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'monday-marion-taylor-pairs-2099-01-12',
    date: '2099-01-12',
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

function entry(overrides: Partial<Entry>): Entry {
  return {
    id: 'e1',
    sessionId: 'monday-marion-taylor-pairs-2099-01-12',
    date: '2099-01-12',
    weekday: 'monday',
    seriesId: 'monday-marion-taylor-pairs',
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

function setProgramme(sessionsList: Session[] = [session()], seriesList: Series[] = [series()], weekdaysList: WeekdayProgramme[] = [weekday()]) {
  useProgrammeMock.mockReturnValue({
    year: 2099,
    programme: { id: '2099', year: 2099, status: 'published', createdAt: '', updatedAt: '' },
    weekdays: weekdaysList,
    series: seriesList,
    sessions: sessionsList,
    loading: false,
    error: null,
  });
}

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<HomeScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('HomeScreen (My Dance Card)', () => {
  it('greets the signed-in member by first name', () => {
    useAuthMock.mockReturnValue({ member: member() });
    setProgramme();
    entriesFixture = [];
    teamsFixture = [];
    renderScreen();
    expect(screen.getByRole('heading', { name: 'Hello, Jane' })).toBeTruthy();
  });

  it('shows the empty state when the member has no upcoming entries', () => {
    useAuthMock.mockReturnValue({ member: member() });
    setProgramme();
    entriesFixture = [];
    teamsFixture = [];
    renderScreen();
    expect(screen.getByText('Nothing on your card yet — open the Programme to sign up.')).toBeTruthy();
  });

  it('groups an upcoming entry by weekday and series, with a status line and a link', () => {
    useAuthMock.mockReturnValue({ member: member() });
    setProgramme();
    entriesFixture = [
      entry({ status: 'confirmed', partner: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' } }),
    ];
    teamsFixture = [];
    renderScreen();
    expect(screen.getByText('Monday Afternoon')).toBeTruthy();
    expect(screen.getByText('Marion Taylor Pairs')).toBeTruthy();
    expect(screen.getByRole('link', { name: /with John Smith/ }).getAttribute('href')).toBe(
      '/session/2099/monday-marion-taylor-pairs-2099-01-12',
    );
  });

  it('keeps the past section collapsed until toggled', async () => {
    useAuthMock.mockReturnValue({ member: member() });
    setProgramme([session({ id: 'past-session', date: '2000-01-03' })]);
    entriesFixture = [
      entry({
        id: 'past-e1',
        sessionId: 'past-session',
        date: '2000-01-03',
        status: 'looking_for_partner',
        partner: null,
      }),
    ];
    teamsFixture = [];
    const user = userEvent.setup();
    renderScreen();

    expect(screen.queryByText('Looking for a partner')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show past' }));
    expect(screen.getByText(/Looking for a partner/)).toBeTruthy();
  });
});

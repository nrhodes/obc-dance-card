import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Entry, Member, Series, Session, Team, WeekdayProgramme } from '@obc/shared';
import type { ProgrammeContextValue } from '../programme/ProgrammeContext';
import { SessionScreen } from './SessionScreen';

const useProgrammeMock = vi.fn<() => ProgrammeContextValue>();
const useAuthMemberMock = vi.fn<() => Member | null>(() => null);

let entriesFixture: Entry[] = [];
let teamsFixture: Team[] = [];

vi.mock('../programme/useProgramme', () => ({
  useProgramme: () => useProgrammeMock(),
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ member: useAuthMemberMock() }),
}));

vi.mock('../members/useMembersDirectory', () => ({
  useMembersDirectory: () => ({
    members: [],
    byId: new Map(),
    nameOf: (id: string) => ({ 'member-a': 'Jane Doe', 'member-b': 'John Smith', 'member-c': 'Amy Lee' })[id] ?? id,
    loading: false,
  }),
}));

vi.mock('../firebase', () => ({ db: {} }));

interface FakeQuery {
  collectionPath: string;
}

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string): FakeQuery => ({ collectionPath: path }),
  query: (base: FakeQuery, ..._constraints: unknown[]) => base,
  where: (_field: string, _op: string, _value: unknown) => ({}),
  onSnapshot: (
    q: FakeQuery,
    onNext: (snap: { docs: Array<{ data: () => unknown }> }) => void,
  ) => {
    const docs = q.collectionPath === 'entries' ? entriesFixture : q.collectionPath === 'teams' ? teamsFixture : [];
    onNext({ docs: docs.map((d) => ({ data: () => d })) });
    return () => {};
  },
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

function entry(overrides: Partial<Entry>): Entry {
  return {
    id: 'e1',
    sessionId: 'monday-marion-taylor-pairs-2027-01-11',
    date: '2027-01-11',
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
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

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

function renderAt(path: string, ui: ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/session/:year/:sessionId" element={ui} />
      </Routes>
    </MemoryRouter>,
  );
}

function setProgramme(sessionsList: Session[], seriesList: Series[] = [series()], weekdaysList: WeekdayProgramme[] = [weekday()]) {
  useProgrammeMock.mockReturnValue({
    year: 2027,
    programme: { id: '2027', year: 2027, status: 'published', createdAt: '', updatedAt: '' },
    weekdays: weekdaysList,
    series: seriesList,
    sessions: sessionsList,
    loading: false,
  });
}

describe('SessionScreen', () => {
  it('shows a plain "No bridge" page for a noBridge session', () => {
    setProgramme([
      session({ id: 'nb1', seriesId: null, kind: 'noBridge', title: 'Good Friday', partnerRequired: false }),
    ]);
    entriesFixture = [];
    renderAt('/session/2027/nb1', <SessionScreen />);
    expect(screen.getByText('No bridge on this date.')).toBeTruthy();
  });

  it('shows "Nobody has signed up yet" for an empty roster', () => {
    setProgramme([session()]);
    entriesFixture = [];
    teamsFixture = [];
    renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
    expect(screen.getByText('Nobody has signed up yet.')).toBeTruthy();
  });

  it('renders a confirmed member-member pair', () => {
    setProgramme([session()]);
    entriesFixture = [
      entry({ id: 'e-a', memberId: 'member-a', pairingId: 'p1', partner: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' } }),
      entry({ id: 'e-b', memberId: 'member-b', pairingId: 'p1', partner: { kind: 'member', memberId: 'member-a', displayName: 'Jane Doe' } }),
    ];
    renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
    expect(screen.getByText(/Jane Doe/)).toBeTruthy();
    expect(screen.getByText(/John Smith/)).toBeTruthy();
  });

  it('shows a visitor pairing with the "(visitor)" marker', () => {
    setProgramme([session()]);
    entriesFixture = [
      entry({ id: 'e-a', memberId: 'member-a', pairingId: 'p-visitor', partner: { kind: 'visitor', visitorId: 'v1', displayName: 'Bob Visitor' } }),
    ];
    renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
    expect(screen.getByText(/Bob Visitor/)).toBeTruthy();
    expect(screen.getByText(/\(visitor\)/)).toBeTruthy();
  });

  it('shows a substitution annotation', () => {
    setProgramme([session()]);
    entriesFixture = [
      entry({
        id: 'e-a',
        memberId: 'member-a',
        pairingId: 'p1',
        status: 'confirmed',
        partner: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' },
        partnerSubstitute: { kind: 'member', memberId: 'member-c', displayName: 'Amy Lee' },
      }),
      entry({
        id: 'e-b',
        memberId: 'member-b',
        pairingId: 'p1',
        status: 'substituted',
        partner: { kind: 'member', memberId: 'member-a', displayName: 'Jane Doe' },
        substitute: { kind: 'member', memberId: 'member-c', displayName: 'Amy Lee' },
      }),
      entry({
        id: 'e-c',
        memberId: 'member-c',
        pairingId: 'p1',
        status: 'confirmed',
        partner: { kind: 'member', memberId: 'member-a', displayName: 'Jane Doe' },
        isSubstituteFor: 'member-b',
      }),
    ];
    renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
    expect(screen.getByText(/sub: Amy Lee for John Smith/)).toBeTruthy();
  });

  it('lists Looking for Partner and Available separately', () => {
    setProgramme([session()]);
    entriesFixture = [
      entry({ id: 'e-lfp', memberId: 'member-a', status: 'looking_for_partner' }),
      entry({ id: 'e-avail', memberId: 'member-b', status: 'available' }),
    ];
    renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
    expect(screen.getByText('Looking for a partner')).toBeTruthy();
    expect(screen.getByText('Available')).toBeTruthy();
  });

  it('renders a Teams roster with captain marker', () => {
    const teamsSeries = series({ id: 'monday-campbell-cave-teams', name: 'Campbell Cave Teams', format: 'Teams' });
    const teamsSession = session({
      id: 'monday-campbell-cave-teams-2027-09-20',
      date: '2027-09-20',
      seriesId: teamsSeries.id,
      title: 'Campbell Cave Teams',
      partnerRequired: false,
      seriesName: teamsSeries.name,
      format: 'Teams',
    });
    setProgramme([teamsSession], [teamsSeries]);
    entriesFixture = [];
    teamsFixture = [
      {
        id: 'monday-campbell-cave-teams-member-a',
        year: 2027,
        seriesId: teamsSeries.id,
        name: 'Doe team',
        captainMemberId: 'member-a',
        members: [
          { ref: { kind: 'member', memberId: 'member-a', displayName: 'Jane Doe' }, joinedAt: '2027-01-01T00:00:00.000Z' },
          { ref: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' }, joinedAt: '2027-01-01T00:00:00.000Z' },
          { ref: { kind: 'visitor', visitorId: 'v1', displayName: 'Bob Visitor' }, joinedAt: '2027-01-01T00:00:00.000Z' },
        ],
        status: 'active',
        createdAt: '2027-01-01T00:00:00.000Z',
        updatedAt: '2027-01-01T00:00:00.000Z',
      },
    ];
    renderAt('/session/2027/monday-campbell-cave-teams-2027-09-20', <SessionScreen />);
    expect(screen.getByText('Doe team')).toBeTruthy();
    expect(screen.getByText(/Captain: Jane Doe/)).toBeTruthy();
    expect(screen.getByText(/Bob Visitor/)).toBeTruthy();
  });

  it('highlights the signed-in member\'s own entry', () => {
    setProgramme([session()]);
    useAuthMemberMock.mockReturnValue(member({ id: 'member-a' }));
    entriesFixture = [
      entry({ id: 'e-a', memberId: 'member-a', status: 'looking_for_partner' }),
    ];
    renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
    expect(screen.getByText("You're looking for a partner.")).toBeTruthy();
    useAuthMemberMock.mockReturnValue(null);
  });

  it('shows a locked note once the session cutoff has passed', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2027-01-12T00:00:00Z'));
      setProgramme([session()]);
      entriesFixture = [];
      renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
      expect(screen.getByText(/This session has started or finished/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

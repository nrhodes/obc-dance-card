import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry, Invite, Member, Programme, Series, Session, Team, Visitor, WeekdayProgramme } from '@obc/shared';
import type { ProgrammeContextValue, ProgrammeYearData } from '../programme/ProgrammeContext';
import { SessionScreen } from './SessionScreen';

const useProgrammeMock = vi.fn<() => ProgrammeContextValue>();
const useAuthMemberMock = vi.fn<() => Member | null>(() => null);

let entriesFixture: Entry[] = [];
let visitorsFixture: Visitor[] = [];
let teamsForSeriesFixture: Team[] = [];
let myTeamFixture: Team | null = null;

vi.mock('../programme/useProgramme', () => ({
  useProgramme: () => useProgrammeMock(),
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ member: useAuthMemberMock() }),
}));

// No admin acting-as in these tests by default — the effective member is the
// signed-in member (mirrors `ActingAsProvider`'s behaviour with nothing
// set). The "acting on behalf" describe block below points
// `effectiveOverride` at a different member to exercise the on-behalf path.
let effectiveOverride: { effectiveMemberId: string; onBehalfOfMemberId?: string; actingAsName?: string | null } | null = null;
vi.mock('../admin/useEffectiveMember', () => ({
  useEffectiveMember: () => {
    const signedInMember = useAuthMemberMock();
    return (
      effectiveOverride ?? {
        effectiveMemberId: signedInMember?.id ?? null,
        onBehalfOfMemberId: undefined,
        actingAsName: null,
      }
    );
  },
}));

vi.mock('../members/useMembersDirectory', () => {
  const directoryMembers = [
    member({ id: 'member-a', firstName: 'Jane', lastName: 'Doe' }),
    member({ id: 'member-b', firstName: 'John', lastName: 'Smith' }),
    member({ id: 'member-c', firstName: 'Amy', lastName: 'Lee' }),
  ];
  return {
    useMembersDirectory: () => ({
      members: directoryMembers,
      byId: new Map(directoryMembers.map((m) => [m.id, m])),
      nameOf: (id: string) => ({ 'member-a': 'Jane Doe', 'member-b': 'John Smith', 'member-c': 'Amy Lee' })[id] ?? id,
      loading: false,
      error: null,
    }),
  };
});

vi.mock('../visitors/useVisitors', () => ({
  useVisitors: () => ({ visitors: visitorsFixture, loading: false }),
}));

type InvitesValue = { incoming: Invite[]; outgoing: Invite[]; resolved: Invite[]; error: { code: string } | null };
const emptyInvites = (): InvitesValue => ({ incoming: [], outgoing: [], resolved: [], error: null });
const useInvitesMock = vi.fn(emptyInvites);
vi.mock('../invites/useInvites', () => ({
  useInvites: () => useInvitesMock(),
}));

vi.mock('../teams/useTeams', () => ({
  useTeams: () => ({
    teams: teamsForSeriesFixture,
    loading: false,
    error: null,
    teamsForSeries: () => teamsForSeriesFixture,
    myTeamForSeries: () => myTeamFixture,
    teamById: (id: string) => teamsForSeriesFixture.find((t) => t.id === id),
  }),
}));

vi.mock('../firebase', () => ({ db: {} }));

const sendInviteMock = vi.fn();
const cancelInviteMock = vi.fn((..._args: unknown[]) => Promise.resolve({} as unknown));
const respondToInviteMock = vi.fn((..._args: unknown[]) => Promise.resolve({ repeatPartnerWarning: false } as unknown));
const claimLookingForPartnerMock = vi.fn();
const setSoloStatusMock = vi.fn();
const clearSoloStatusMock = vi.fn();
const cancelEntryMock = vi.fn();
const signUpWithVisitorMock = vi.fn();
const setSubstituteMock = vi.fn();
const clearSubstituteMock = vi.fn();
const createVisitorMock = vi.fn();
const inviteToTeamMock = vi.fn();
const createTeamMock = vi.fn();
const addVisitorToTeamMock = vi.fn();
const removeVisitorFromTeamMock = vi.fn();
const leaveTeamMock = vi.fn();
const removeFromTeamMock = vi.fn();
const transferCaptaincyMock = vi.fn();
const disbandTeamMock = vi.fn();
const addTeamSessionSubstituteMock = vi.fn();
const clearTeamSessionSubstituteMock = vi.fn();

vi.mock('../api', () => ({
  sendInvite: (...args: unknown[]) => sendInviteMock(...args),
  cancelInvite: (...args: unknown[]) => cancelInviteMock(...args),
  respondToInvite: (...args: unknown[]) => respondToInviteMock(...args),
  claimLookingForPartner: (...args: unknown[]) => claimLookingForPartnerMock(...args),
  setSoloStatus: (...args: unknown[]) => setSoloStatusMock(...args),
  clearSoloStatus: (...args: unknown[]) => clearSoloStatusMock(...args),
  cancelEntry: (...args: unknown[]) => cancelEntryMock(...args),
  signUpWithVisitor: (...args: unknown[]) => signUpWithVisitorMock(...args),
  setSubstitute: (...args: unknown[]) => setSubstituteMock(...args),
  clearSubstitute: (...args: unknown[]) => clearSubstituteMock(...args),
  createVisitor: (...args: unknown[]) => createVisitorMock(...args),
  inviteToTeam: (...args: unknown[]) => inviteToTeamMock(...args),
  createTeam: (...args: unknown[]) => createTeamMock(...args),
  addVisitorToTeam: (...args: unknown[]) => addVisitorToTeamMock(...args),
  removeVisitorFromTeam: (...args: unknown[]) => removeVisitorFromTeamMock(...args),
  leaveTeam: (...args: unknown[]) => leaveTeamMock(...args),
  removeFromTeam: (...args: unknown[]) => removeFromTeamMock(...args),
  transferCaptaincy: (...args: unknown[]) => transferCaptaincyMock(...args),
  disbandTeam: (...args: unknown[]) => disbandTeamMock(...args),
  addTeamSessionSubstitute: (...args: unknown[]) => addTeamSessionSubstituteMock(...args),
  clearTeamSessionSubstitute: (...args: unknown[]) => clearTeamSessionSubstituteMock(...args),
}));

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
    const docs = q.collectionPath === 'entries' ? entriesFixture : [];
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
    cohort: 'club',
    active: true,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function visitor(overrides: Partial<Visitor> = {}): Visitor {
  return {
    id: 'v1',
    displayName: 'Bob Visitor',
    createdByMemberId: 'member-a',
    courtesyEmails: false,
    lastUsedAt: '2027-01-01T00:00:00.000Z',
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function team(overrides: Partial<Team> = {}): Team {
  return {
    id: 'monday-campbell-cave-teams-member-a',
    year: 2027,
    seriesId: 'monday-campbell-cave-teams',
    name: 'Doe team',
    captainMemberId: 'member-a',
    cohort: 'club',
    members: [
      { ref: { kind: 'member', memberId: 'member-a', displayName: 'Jane Doe' }, joinedAt: '2027-01-01T00:00:00.000Z' },
      { ref: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' }, joinedAt: '2027-01-01T00:00:00.000Z' },
    ],
    status: 'forming',
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderAt(path: string, ui: ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/session/:year/:sessionId" element={ui} />
      </Routes>
    </MemoryRouter>,
  );
}

// `useProgramme` is fully mocked here (not `ProgrammeProvider` + a real
// `useProgramme(year)`), so this stands in for whatever the hook would
// return for the route's year — mirrors `ProgrammeProvider`'s merged,
// year-tagged shape (plan §21 B3) so the mock stays structurally honest.
function setProgramme(sessionsList: Session[], seriesList: Series[] = [series()], weekdaysList: WeekdayProgramme[] = [weekday()]) {
  const year = 2027;
  const programmeDoc: Programme = { id: String(year), year, status: 'published', createdAt: '', updatedAt: '' };
  const byYear: ProgrammeYearData[] = [{ year, programme: programmeDoc, weekdays: weekdaysList, series: seriesList, sessions: sessionsList }];
  useProgrammeMock.mockReturnValue({
    loading: false,
    error: null,
    years: [year],
    byYear,
    weekdays: weekdaysList.map((w) => ({ ...w, year })),
    series: seriesList.map((s) => ({ ...s, year })),
    sessions: sessionsList.map((s) => ({ ...s, year })),
    year,
    programme: programmeDoc,
  });
}

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

describe('SessionScreen', () => {
  beforeEach(() => {
    useInvitesMock.mockReturnValue(emptyInvites());
    // The entries-roster query now waits for the signed-in member's own
    // cohort (App-Store-review cohort partition, plan §8.1, decided
    // 2026-09-05) before subscribing — default every test in this describe
    // block to a signed-in member unless a test overrides it (several below
    // deliberately set `useAuthMemberMock.mockReturnValue(null)` to exercise
    // the signed-out/acting-as-nobody path, which still works: the mock call
    // in the test body runs after this one and wins).
    useAuthMemberMock.mockReturnValue(member({ id: 'member-a' }));
  });

  it('shows a plain "No bridge" page for a noBridge session', () => {
    setProgramme([
      session({ id: 'nb1', seriesId: null, kind: 'noBridge', title: 'Good Friday', partnerRequired: false }),
    ]);
    entriesFixture = [];
    renderAt('/session/2027/nb1', <SessionScreen />);
    expect(screen.getByText('No bridge on this date.')).toBeTruthy();
  });

  it('shows a pending-invite panel (not the Actions) when you have an outgoing invite for the session', () => {
    setProgramme([session()]);
    entriesFixture = [];
    useInvitesMock.mockReturnValue({
      incoming: [],
      outgoing: [
        {
          id: 'inv-1', scope: 'session' as const, year: 2027,
          sessionIds: ['monday-marion-taylor-pairs-2027-01-11'], seriesId: 'monday-marion-taylor-pairs',
          teamId: null, fromMemberId: 'member-a', toMemberId: 'member-b', status: 'pending',
          createdBy: 'member-a', expiresAt: '2099-01-01T00:00:00.000Z', createdAt: 'now', updatedAt: 'now',
        } as Invite,
      ],
      resolved: [], error: null,
    });
    renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
    expect(screen.getByText('Waiting for a reply')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel invitation' })).toBeTruthy();
    // The Actions block is suppressed while an invite is pending.
    expect(screen.queryByRole('button', { name: 'Invite a partner' })).toBeNull();
  });

    it('shows "Nobody has signed up yet" for an empty roster', () => {
    setProgramme([session()]);
    entriesFixture = [];
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
    // The signed-in "You: confirmed with John Smith" own-entry summary card
    // and the roster list both mention John Smith.
    expect(screen.getAllByText(/John Smith/).length).toBeGreaterThan(0);
  });

  it('shows a visitor pairing with the "(visitor)" marker', () => {
    setProgramme([session()]);
    entriesFixture = [
      entry({ id: 'e-a', memberId: 'member-a', pairingId: 'p-visitor', partner: { kind: 'visitor', visitorId: 'v1', displayName: 'Bob Visitor' } }),
    ];
    renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
    // The signed-in "You: confirmed with Bob Visitor" own-entry summary card
    // and the roster list both mention "Bob Visitor (visitor)", so assert on
    // every match rather than a single unique one.
    expect(screen.getAllByText(/Bob Visitor/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\(visitor\)/).length).toBeGreaterThan(0);
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
    teamsForSeriesFixture = [
      team({
        members: [
          { ref: { kind: 'member', memberId: 'member-a', displayName: 'Jane Doe' }, joinedAt: '2027-01-01T00:00:00.000Z' },
          { ref: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' }, joinedAt: '2027-01-01T00:00:00.000Z' },
          { ref: { kind: 'visitor', visitorId: 'v1', displayName: 'Bob Visitor' }, joinedAt: '2027-01-01T00:00:00.000Z' },
        ],
        status: 'active',
      }),
    ];
    myTeamFixture = null;
    setProgramme([teamsSession], [teamsSeries]);
    entriesFixture = [];
    renderAt('/session/2027/monday-campbell-cave-teams-2027-09-20', <SessionScreen />);
    expect(screen.getByText('Doe team')).toBeTruthy();
    expect(screen.getByText(/Captain: Jane Doe/)).toBeTruthy();
    expect(screen.getByText(/Bob Visitor/)).toBeTruthy();
    teamsForSeriesFixture = [];
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
      expect(screen.getByText('This session has started.')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  describe('actions', () => {
    it('offers Invite/LFP/Available/Play with a visitor when the member has no entry', () => {
      setProgramme([session()]);
      useAuthMemberMock.mockReturnValue(member({ id: 'member-a' }));
      entriesFixture = [];
      renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
      expect(screen.getByRole('button', { name: 'Invite a partner' })).toBeTruthy();
      expect(screen.getByRole('button', { name: "I'm looking for a partner" })).toBeTruthy();
      expect(screen.getByRole('button', { name: "I'm available" })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Play with a visitor' })).toBeTruthy();
      useAuthMemberMock.mockReturnValue(null);
    });

    it('offers Change/Remove when the member has a solo listing', () => {
      setProgramme([session()]);
      useAuthMemberMock.mockReturnValue(member({ id: 'member-a' }));
      entriesFixture = [entry({ id: 'e-a', memberId: 'member-a', status: 'looking_for_partner' })];
      renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
      expect(screen.getByRole('button', { name: 'Switch to available' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
      useAuthMemberMock.mockReturnValue(null);
    });

    it('offers Cancel this session when the member is confirmed, and explains the consequence', async () => {
      cancelEntryMock.mockResolvedValueOnce({ entry: entry({ id: 'e-a', memberId: 'member-a', status: 'cancelled' }) });
      setProgramme([session()]);
      useAuthMemberMock.mockReturnValue(member({ id: 'member-a' }));
      entriesFixture = [
        entry({
          id: 'e-a',
          memberId: 'member-a',
          status: 'confirmed',
          pairingId: 'p1',
          partner: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' },
        }),
      ];
      const user = userEvent.setup();
      renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
      await user.click(screen.getByRole('button', { name: 'Cancel this session' }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText(/John Smith will be told you've cancelled/)).toBeTruthy();
      await user.click(within(dialog).getByRole('button', { name: 'Cancel this session' }));
      expect(cancelEntryMock).toHaveBeenCalledWith({ entryId: 'e-a' });
      useAuthMemberMock.mockReturnValue(null);
    });

    it('shows "Play with X" for a looking_for_partner roster row when the viewer is free', async () => {
      claimLookingForPartnerMock.mockResolvedValueOnce({ entries: [], repeatPartnerWarning: false });
      setProgramme([session()]);
      useAuthMemberMock.mockReturnValue(member({ id: 'member-a' }));
      entriesFixture = [entry({ id: 'e-b', memberId: 'member-b', status: 'looking_for_partner' })];
      const user = userEvent.setup();
      renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
      await user.click(screen.getByRole('button', { name: 'Play with John Smith' }));
      await user.click(screen.getByRole('button', { name: 'Play with them' }));
      expect(claimLookingForPartnerMock).toHaveBeenCalledWith({ year: 2027, sessionId: session().id, posterMemberId: 'member-b' });
      useAuthMemberMock.mockReturnValue(null);
    });
  });

  describe('play with a visitor', () => {
    it('signs up with a visitor for the single session', async () => {
      signUpWithVisitorMock.mockResolvedValueOnce({ entries: [] });
      visitorsFixture = [visitor()];
      setProgramme([session()]);
      useAuthMemberMock.mockReturnValue(member({ id: 'member-a' }));
      entriesFixture = [];
      const user = userEvent.setup();
      renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
      await user.click(screen.getByRole('button', { name: 'Play with a visitor' }));
      await user.click(screen.getByRole('button', { name: 'Bob Visitor' }));
      expect(signUpWithVisitorMock).toHaveBeenCalledWith({
        scope: 'session',
        year: 2027,
        visitorId: 'v1',
        sessionId: session().id,
      });
      useAuthMemberMock.mockReturnValue(null);
      visitorsFixture = [];
    });

    it('offers the whole-series toggle and signs up for the series when checked', async () => {
      signUpWithVisitorMock.mockResolvedValueOnce({ entries: [] });
      visitorsFixture = [visitor()];
      setProgramme([session()], [series({ sessionIds: ['s1', 's2', 's3'] })]);
      useAuthMemberMock.mockReturnValue(member({ id: 'member-a' }));
      entriesFixture = [];
      const user = userEvent.setup();
      renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
      await user.click(screen.getByRole('button', { name: 'Play with a visitor' }));
      await user.click(screen.getByRole('checkbox', { name: /whole series/i }));
      await user.click(screen.getByRole('button', { name: 'Bob Visitor' }));
      expect(signUpWithVisitorMock).toHaveBeenCalledWith({
        scope: 'series',
        year: 2027,
        visitorId: 'v1',
        seriesId: 'monday-marion-taylor-pairs',
      });
      useAuthMemberMock.mockReturnValue(null);
      visitorsFixture = [];
    });
  });

  describe('substitutes', () => {
    it('arranges a substitute for the partner (coverFor: self)', async () => {
      setSubstituteMock.mockResolvedValueOnce({ entries: [] });
      setProgramme([session()], [series({ allowSubstitute: true })]);
      useAuthMemberMock.mockReturnValue(member({ id: 'member-a' }));
      entriesFixture = [
        entry({
          id: 'e-a',
          memberId: 'member-a',
          status: 'confirmed',
          pairingId: 'p1',
          partner: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' },
        }),
        entry({
          id: 'e-b',
          memberId: 'member-b',
          status: 'confirmed',
          pairingId: 'p1',
          partner: { kind: 'member', memberId: 'member-a', displayName: 'Jane Doe' },
        }),
      ];
      const user = userEvent.setup();
      renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
      await user.click(screen.getByRole('button', { name: 'Arrange a substitute' }));
      await user.click(screen.getByRole('button', { name: "I can't come — someone will play with John Smith instead" }));
      // member-c (Amy Lee) is the only pickable member left (self and partner excluded).
      await user.click(screen.getByRole('button', { name: /Amy Lee/ }));
      expect(setSubstituteMock).toHaveBeenCalledWith({
        entryId: 'e-a',
        substitute: { kind: 'member', memberId: 'member-c' },
        coverFor: 'self',
      });
      useAuthMemberMock.mockReturnValue(null);
    });

    it('arranges a substitute for self (coverFor: partner)', async () => {
      setSubstituteMock.mockResolvedValueOnce({ entries: [] });
      setProgramme([session()], [series({ allowSubstitute: true })]);
      useAuthMemberMock.mockReturnValue(member({ id: 'member-a' }));
      entriesFixture = [
        entry({
          id: 'e-a',
          memberId: 'member-a',
          status: 'confirmed',
          pairingId: 'p1',
          partner: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' },
        }),
        entry({
          id: 'e-b',
          memberId: 'member-b',
          status: 'confirmed',
          pairingId: 'p1',
          partner: { kind: 'member', memberId: 'member-a', displayName: 'Jane Doe' },
        }),
      ];
      const user = userEvent.setup();
      renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
      await user.click(screen.getByRole('button', { name: 'Arrange a substitute' }));
      await user.click(screen.getByRole('button', { name: 'John Smith can\'t come — someone will play with me instead' }));
      await user.click(screen.getByRole('button', { name: /Amy Lee/ }));
      expect(setSubstituteMock).toHaveBeenCalledWith({
        entryId: 'e-a',
        substitute: { kind: 'member', memberId: 'member-c' },
        coverFor: 'partner',
      });
      useAuthMemberMock.mockReturnValue(null);
    });

    it('shows "This series does not allow substitutes" instead of the button', () => {
      setProgramme([session()], [series({ allowSubstitute: false })]);
      useAuthMemberMock.mockReturnValue(member({ id: 'member-a' }));
      entriesFixture = [
        entry({
          id: 'e-a',
          memberId: 'member-a',
          status: 'confirmed',
          pairingId: 'p1',
          partner: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' },
        }),
      ];
      renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
      expect(screen.getByText('This series does not allow substitutes.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Arrange a substitute' })).toBeNull();
      useAuthMemberMock.mockReturnValue(null);
    });

    it('shows the visitor-pairing hint instead of a substitute button', () => {
      setProgramme([session()], [series({ allowSubstitute: true })]);
      useAuthMemberMock.mockReturnValue(member({ id: 'member-a' }));
      entriesFixture = [
        entry({
          id: 'e-a',
          memberId: 'member-a',
          status: 'confirmed',
          pairingId: 'p1',
          partner: { kind: 'visitor', visitorId: 'v1', displayName: 'Bob Visitor' },
        }),
      ];
      renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
      expect(screen.getByText('To change a visitor partner, cancel and sign up again.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Arrange a substitute' })).toBeNull();
      useAuthMemberMock.mockReturnValue(null);
    });

    it('shows an already-arranged substitute with a Remove substitute button', async () => {
      clearSubstituteMock.mockResolvedValueOnce({ entries: [] });
      setProgramme([session()], [series({ allowSubstitute: true })]);
      useAuthMemberMock.mockReturnValue(member({ id: 'member-b' }));
      entriesFixture = [
        entry({
          id: 'e-a',
          memberId: 'member-a',
          status: 'substituted',
          pairingId: 'p1',
          partner: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' },
          substitute: { kind: 'member', memberId: 'member-c', displayName: 'Amy Lee' },
        }),
        entry({
          id: 'e-b',
          memberId: 'member-b',
          status: 'confirmed',
          pairingId: 'p1',
          partner: { kind: 'member', memberId: 'member-a', displayName: 'Jane Doe' },
          partnerSubstitute: { kind: 'member', memberId: 'member-c', displayName: 'Amy Lee' },
        }),
      ];
      const user = userEvent.setup();
      renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
      expect(screen.getByText(/Amy Lee is standing in for Jane Doe this week/)).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Remove substitute' }));
      await user.click(screen.getByRole('dialog').querySelector('button.button-danger')!);
      expect(clearSubstituteMock).toHaveBeenCalledWith({ entryId: 'e-b' });
      useAuthMemberMock.mockReturnValue(null);
    });
  });

  describe('team panel', () => {
    it('shows "Start a team" and the noticeboard when not on a team', () => {
      myTeamFixture = null;
      teamsForSeriesFixture = [];
      setProgramme([teamsSession], [teamsSeries]);
      useAuthMemberMock.mockReturnValue(member({ id: 'member-a' }));
      entriesFixture = [];
      renderAt('/session/2027/monday-campbell-cave-teams-2027-09-20', <SessionScreen />);
      expect(screen.getByRole('button', { name: 'Start a team' })).toBeTruthy();
      expect(screen.getByRole('button', { name: "I'm looking for a team" })).toBeTruthy();
      expect(screen.getByRole('button', { name: "I'm available for a team" })).toBeTruthy();
      useAuthMemberMock.mockReturnValue(null);
    });

    it('shows Leave team for a plain member', () => {
      const t = team();
      myTeamFixture = t;
      teamsForSeriesFixture = [t];
      setProgramme([teamsSession], [teamsSeries]);
      useAuthMemberMock.mockReturnValue(member({ id: 'member-b' }));
      entriesFixture = [entry({ id: 'e-b', memberId: 'member-b', teamId: t.id, partner: null, sessionId: teamsSession.id })];
      renderAt('/session/2027/monday-campbell-cave-teams-2027-09-20', <SessionScreen />);
      expect(screen.getByRole('button', { name: 'Leave team' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Disband team' })).toBeNull();
      useAuthMemberMock.mockReturnValue(null);
      myTeamFixture = null;
      teamsForSeriesFixture = [];
    });

    it('shows captain actions, including "Add a substitute for this session" only when someone is absent', () => {
      const t = team();
      myTeamFixture = t;
      teamsForSeriesFixture = [t];
      setProgramme([teamsSession], [teamsSeries]);
      useAuthMemberMock.mockReturnValue(member({ id: 'member-a' }));
      entriesFixture = [
        entry({ id: 'e-a', memberId: 'member-a', teamId: t.id, partner: null, sessionId: teamsSession.id, date: teamsSession.date }),
        entry({ id: 'e-b', memberId: 'member-b', teamId: t.id, partner: null, sessionId: teamsSession.id, date: teamsSession.date, status: 'cancelled' }),
      ];
      renderAt('/session/2027/monday-campbell-cave-teams-2027-09-20', <SessionScreen />);
      expect(screen.getByRole('button', { name: 'Invite a member' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Add a visitor' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Transfer captaincy' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Disband team' })).toBeTruthy();
      const addSubButton = screen.getByRole('button', { name: 'Add a substitute for this session' }) as HTMLButtonElement;
      expect(addSubButton.disabled).toBe(false);
      expect(screen.getByText(/Absent: John Smith/)).toBeTruthy();
      useAuthMemberMock.mockReturnValue(null);
      myTeamFixture = null;
      teamsForSeriesFixture = [];
    });

    it('disables "Add a substitute for this session" when nobody is absent', () => {
      const t = team();
      myTeamFixture = t;
      teamsForSeriesFixture = [t];
      setProgramme([teamsSession], [teamsSeries]);
      useAuthMemberMock.mockReturnValue(member({ id: 'member-a' }));
      entriesFixture = [
        entry({ id: 'e-a', memberId: 'member-a', teamId: t.id, partner: null, sessionId: teamsSession.id, date: teamsSession.date }),
        entry({ id: 'e-b', memberId: 'member-b', teamId: t.id, partner: null, sessionId: teamsSession.id, date: teamsSession.date }),
      ];
      renderAt('/session/2027/monday-campbell-cave-teams-2027-09-20', <SessionScreen />);
      const addSubButton = screen.getByRole('button', { name: 'Add a substitute for this session' }) as HTMLButtonElement;
      expect(addSubButton.disabled).toBe(true);
      useAuthMemberMock.mockReturnValue(null);
      myTeamFixture = null;
      teamsForSeriesFixture = [];
    });
  });

  // Plan Phase 6b task deliverable 2 + Tests section: while an admin is
  // acting on behalf of a member, every one of these callable payloads must
  // carry `onBehalfOfMemberId` — asserted here by mocking `useEffectiveMember`
  // (`effectiveOverride`) to a different member than the signed-in admin.
  describe('acting on behalf', () => {
    const actingAs = { effectiveMemberId: 'member-a', onBehalfOfMemberId: 'member-a', actingAsName: 'Jane Doe' };

    afterEach(() => {
      effectiveOverride = null;
      useAuthMemberMock.mockReturnValue(null);
      myTeamFixture = null;
      teamsForSeriesFixture = [];
      visitorsFixture = [];
    });

    it('includes onBehalfOfMemberId when sending an invite', async () => {
      effectiveOverride = actingAs;
      setProgramme([session()]);
      useAuthMemberMock.mockReturnValue(member({ id: 'admin-1', role: 'admin' }));
      entriesFixture = [entry({ id: 'e-b', memberId: 'member-b', status: 'available' })];
      const user = userEvent.setup();
      renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
      await user.click(screen.getByRole('button', { name: 'Invite John Smith' }));
      await user.click(screen.getByRole('button', { name: 'Send invite' }));
      expect(sendInviteMock).toHaveBeenCalledWith(expect.objectContaining({ onBehalfOfMemberId: 'member-a' }));
    });

    it('includes onBehalfOfMemberId when setting a solo status', async () => {
      effectiveOverride = actingAs;
      setProgramme([session()]);
      useAuthMemberMock.mockReturnValue(member({ id: 'admin-1', role: 'admin' }));
      entriesFixture = [];
      const user = userEvent.setup();
      renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
      await user.click(screen.getByRole('button', { name: "I'm looking for a partner" }));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
      expect(setSoloStatusMock).toHaveBeenCalledWith(expect.objectContaining({ onBehalfOfMemberId: 'member-a' }));
    });

    it('includes onBehalfOfMemberId when cancelling an entry', async () => {
      cancelEntryMock.mockResolvedValueOnce({ entry: entry({ id: 'e-a', memberId: 'member-a', status: 'cancelled' }) });
      effectiveOverride = actingAs;
      setProgramme([session()]);
      useAuthMemberMock.mockReturnValue(member({ id: 'admin-1', role: 'admin' }));
      entriesFixture = [
        entry({
          id: 'e-a',
          memberId: 'member-a',
          status: 'confirmed',
          pairingId: 'p1',
          partner: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' },
        }),
      ];
      const user = userEvent.setup();
      renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
      await user.click(screen.getByRole('button', { name: 'Cancel this session' }));
      const dialog = screen.getByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Cancel this session' }));
      expect(cancelEntryMock).toHaveBeenCalledWith(expect.objectContaining({ entryId: 'e-a', onBehalfOfMemberId: 'member-a' }));
    });

    it('includes onBehalfOfMemberId when signing up with a visitor', async () => {
      signUpWithVisitorMock.mockResolvedValueOnce({ entries: [] });
      effectiveOverride = actingAs;
      visitorsFixture = [visitor()];
      setProgramme([session()]);
      useAuthMemberMock.mockReturnValue(member({ id: 'admin-1', role: 'admin' }));
      entriesFixture = [];
      const user = userEvent.setup();
      renderAt('/session/2027/monday-marion-taylor-pairs-2027-01-11', <SessionScreen />);
      await user.click(screen.getByRole('button', { name: 'Play with a visitor' }));
      await user.click(screen.getByRole('button', { name: 'Bob Visitor' }));
      expect(signUpWithVisitorMock).toHaveBeenCalledWith(expect.objectContaining({ onBehalfOfMemberId: 'member-a' }));
    });

    it('includes onBehalfOfMemberId when starting a team', async () => {
      createTeamMock.mockResolvedValueOnce({ team: team(), entries: [] });
      effectiveOverride = actingAs;
      myTeamFixture = null;
      teamsForSeriesFixture = [];
      setProgramme([teamsSession], [teamsSeries]);
      useAuthMemberMock.mockReturnValue(member({ id: 'admin-1', role: 'admin' }));
      entriesFixture = [];
      const user = userEvent.setup();
      renderAt('/session/2027/monday-campbell-cave-teams-2027-09-20', <SessionScreen />);
      await user.click(screen.getByRole('button', { name: 'Start a team' }));
      await user.click(screen.getByRole('button', { name: 'Start team' }));
      expect(createTeamMock).toHaveBeenCalledWith(expect.objectContaining({ onBehalfOfMemberId: 'member-a' }));
    });
  });
});

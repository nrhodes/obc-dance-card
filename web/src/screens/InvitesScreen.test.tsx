import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Invite } from '@obc/shared';
import { InvitesScreen } from './InvitesScreen';

const respondToInviteMock = vi.fn();
const cancelInviteMock = vi.fn();

vi.mock('../api', () => ({
  respondToInvite: (...args: unknown[]) => respondToInviteMock(...args),
  cancelInvite: (...args: unknown[]) => cancelInviteMock(...args),
}));

afterEach(() => {
  respondToInviteMock.mockReset();
  cancelInviteMock.mockReset();
  teamsFixture = [];
});

let invitesFixture: { incoming: Invite[]; outgoing: Invite[]; resolved: Invite[]; loading: boolean } = {
  incoming: [],
  outgoing: [],
  resolved: [],
  loading: false,
};

vi.mock('../invites/useInvites', () => ({
  useInvites: () => invitesFixture,
}));

vi.mock('../members/useMembersDirectory', () => ({
  useMembersDirectory: () => ({
    members: [],
    byId: new Map(),
    nameOf: (id: string) => ({ 'member-a': 'Jane Doe', 'member-b': 'John Smith' })[id] ?? id,
    loading: false,
  }),
}));

let teamsFixture: Array<{ id: string; name: string }> = [];

vi.mock('../teams/useTeams', () => ({
  useTeams: () => ({
    teams: teamsFixture,
    loading: false,
    teamsForSeries: () => teamsFixture,
    myTeamForSeries: () => null,
    teamById: (id: string) => teamsFixture.find((t) => t.id === id),
  }),
}));

vi.mock('../programme/useProgramme', () => ({
  useProgramme: () => ({
    year: 2027,
    programme: null,
    weekdays: [],
    series: [
      {
        id: 'monday-campbell-cave-teams',
        weekday: 'monday',
        name: 'Campbell Cave Teams',
        scoring: 'Scr',
        format: 'Teams',
        bestOf: null,
        allowSubstitute: true,
        order: 0,
        sessionIds: [],
        teamMin: 4,
        teamMax: 6,
        createdAt: '',
        updatedAt: '',
      },
    ],
    sessions: [
      {
        id: 's1',
        date: '2027-01-11',
        weekday: 'monday',
        seriesId: null,
        kind: 'series',
        title: 'Marion Taylor Pairs',
        partnerRequired: true,
        createdAt: '',
        updatedAt: '',
      },
    ],
    loading: false,
  }),
}));

function invite(overrides: Partial<Invite>): Invite {
  return {
    id: 'invite-1',
    scope: 'session',
    year: 2027,
    sessionIds: ['s1'],
    seriesId: null,
    teamId: null,
    fromMemberId: 'member-b',
    toMemberId: 'member-a',
    status: 'pending',
    createdBy: 'member-b',
    expiresAt: '2027-01-11T01:00:00.000Z',
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('InvitesScreen', () => {
  it('shows empty states when there is nothing to act on', () => {
    invitesFixture = { incoming: [], outgoing: [], resolved: [], loading: false };
    render(<InvitesScreen />);
    expect(screen.getByText('No invites waiting for you.')).toBeTruthy();
    expect(screen.getByText('You have no pending invites out.')).toBeTruthy();
    expect(screen.getByText('Nothing yet.')).toBeTruthy();
  });

  it('accepts an incoming invite and shows the repeat-partner notice', async () => {
    respondToInviteMock.mockResolvedValueOnce({ invite: invite({ status: 'accepted' }), entries: [], repeatPartnerWarning: true });
    invitesFixture = { incoming: [invite({})], outgoing: [], resolved: [], loading: false };
    const user = userEvent.setup();
    render(<InvitesScreen />);

    expect(screen.getByText(/John Smith/)).toBeTruthy();
    expect(screen.getByText(/single session/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Accept' }));

    expect(respondToInviteMock).toHaveBeenCalledWith({ inviteId: 'invite-1', accept: true });
    expect(await screen.findByText(/already played with John Smith/)).toBeTruthy();
  });

  it('declines an incoming invite', async () => {
    respondToInviteMock.mockResolvedValueOnce({ invite: invite({ status: 'declined' }), entries: [] });
    invitesFixture = { incoming: [invite({})], outgoing: [], resolved: [], loading: false };
    const user = userEvent.setup();
    render(<InvitesScreen />);

    await user.click(screen.getByRole('button', { name: 'Decline' }));
    expect(respondToInviteMock).toHaveBeenCalledWith({ inviteId: 'invite-1', accept: false });
  });

  it('withdraws an outgoing invite', async () => {
    cancelInviteMock.mockResolvedValueOnce({ invite: invite({ status: 'cancelled', fromMemberId: 'member-a', toMemberId: 'member-b' }) });
    invitesFixture = {
      incoming: [],
      outgoing: [invite({ fromMemberId: 'member-a', toMemberId: 'member-b' })],
      resolved: [],
      loading: false,
    };
    const user = userEvent.setup();
    render(<InvitesScreen />);

    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(cancelInviteMock).toHaveBeenCalledWith({ inviteId: 'invite-1' });
  });

  it('shows a failed-precondition error verbatim when accepting fails', async () => {
    respondToInviteMock.mockRejectedValueOnce({
      code: 'failed-precondition',
      message: 'Conflicting session(s): 2027-01-11. The invite is still pending.',
    });
    invitesFixture = { incoming: [invite({})], outgoing: [], resolved: [], loading: false };
    const user = userEvent.setup();
    render(<InvitesScreen />);

    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Conflicting session(s): 2027-01-11. The invite is still pending.',
    );
  });

  it('maps a resource-exhausted decline error to a fixed message', async () => {
    respondToInviteMock.mockRejectedValueOnce({ code: 'resource-exhausted', message: 'internal' });
    invitesFixture = { incoming: [invite({})], outgoing: [], resolved: [], loading: false };
    const user = userEvent.setup();
    render(<InvitesScreen />);

    await user.click(screen.getByRole('button', { name: 'Decline' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Too many invites today');
  });

  it('labels a team join invite "Team invite from <captain> — <team name> (<series>)"', () => {
    teamsFixture = [{ id: 'team-1', name: 'Doe team' }];
    invitesFixture = {
      incoming: [
        invite({
          scope: 'team',
          kind: 'join',
          teamId: 'team-1',
          seriesId: 'monday-campbell-cave-teams',
          sessionIds: ['s-teams-1'],
        }),
      ],
      outgoing: [],
      resolved: [],
      loading: false,
    };
    render(<InvitesScreen />);
    expect(screen.getByText('Team invite from John Smith — Doe team (Campbell Cave Teams)')).toBeTruthy();
  });

  it('labels a captaincy offer "<name> wants you to be captain of <team>"', () => {
    teamsFixture = [{ id: 'team-1', name: 'Doe team' }];
    invitesFixture = {
      incoming: [invite({ scope: 'team', kind: 'captaincy', teamId: 'team-1', seriesId: 'monday-campbell-cave-teams', sessionIds: [] })],
      outgoing: [],
      resolved: [],
      loading: false,
    };
    render(<InvitesScreen />);
    expect(screen.getByText('John Smith wants you to be captain of Doe team')).toBeTruthy();
  });

  it('lists recently resolved invites read-only', () => {
    invitesFixture = {
      incoming: [],
      outgoing: [],
      resolved: [invite({ id: 'resolved-1', status: 'accepted' })],
      loading: false,
    };
    render(<InvitesScreen />);
    expect(screen.getByText(/accepted/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  });
});

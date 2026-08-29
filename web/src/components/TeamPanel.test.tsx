import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Member, Series, Session, Team } from '@obc/shared';
import { TeamPanel } from './TeamPanel';

const createTeamMock = vi.fn();
const inviteToTeamMock = vi.fn();
const addVisitorToTeamMock = vi.fn();
const removeVisitorFromTeamMock = vi.fn();
const leaveTeamMock = vi.fn();
const removeFromTeamMock = vi.fn();
const transferCaptaincyMock = vi.fn();
const disbandTeamMock = vi.fn();
const addTeamSessionSubstituteMock = vi.fn();
const clearTeamSessionSubstituteMock = vi.fn();
const createVisitorMock = vi.fn();

vi.mock('../api', () => ({
  createTeam: (...args: unknown[]) => createTeamMock(...args),
  inviteToTeam: (...args: unknown[]) => inviteToTeamMock(...args),
  addVisitorToTeam: (...args: unknown[]) => addVisitorToTeamMock(...args),
  removeVisitorFromTeam: (...args: unknown[]) => removeVisitorFromTeamMock(...args),
  leaveTeam: (...args: unknown[]) => leaveTeamMock(...args),
  removeFromTeam: (...args: unknown[]) => removeFromTeamMock(...args),
  transferCaptaincy: (...args: unknown[]) => transferCaptaincyMock(...args),
  disbandTeam: (...args: unknown[]) => disbandTeamMock(...args),
  addTeamSessionSubstitute: (...args: unknown[]) => addTeamSessionSubstituteMock(...args),
  clearTeamSessionSubstitute: (...args: unknown[]) => clearTeamSessionSubstituteMock(...args),
  createVisitor: (...args: unknown[]) => createVisitorMock(...args),
}));

function series(overrides: Partial<Series> = {}): Series {
  return {
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
    ...overrides,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'monday-campbell-cave-teams-2027-09-20',
    date: '2027-09-20',
    weekday: 'monday',
    seriesId: 'monday-campbell-cave-teams',
    kind: 'series',
    title: 'Campbell Cave Teams',
    partnerRequired: false,
    format: 'Teams',
    createdAt: '',
    updatedAt: '',
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
    members: [
      { ref: { kind: 'member', memberId: 'member-a', displayName: 'Jane Doe' }, joinedAt: '' },
      { ref: { kind: 'member', memberId: 'member-b', displayName: 'John Smith' }, joinedAt: '' },
    ],
    status: 'forming',
    createdAt: '',
    updatedAt: '',
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

const nameOf = (id: string) => ({ 'member-a': 'Jane Doe', 'member-b': 'John Smith', 'member-c': 'Amy Lee' })[id] ?? id;
const members: Member[] = [
  member({ id: 'member-a', firstName: 'Jane', lastName: 'Doe' }),
  member({ id: 'member-b', firstName: 'John', lastName: 'Smith' }),
  member({ id: 'member-c', firstName: 'Amy', lastName: 'Lee' }),
];

const noop = () => {};

describe('TeamPanel: not on a team', () => {
  it('starts a team', async () => {
    createTeamMock.mockResolvedValueOnce({ team: team(), entries: [] });
    const onNotice = vi.fn();
    const user = userEvent.setup();
    render(
      <TeamPanel
        year={2027}
        series={series()}
        session={session()}
        role={{ kind: 'notOnTeam', solo: null }}
        team={null}
        otherTeams={[]}
        sessionEntries={[]}
        member={member()}
        members={members}
        nameOf={nameOf}
        visitors={[]}
        onNotice={onNotice}
        onSolo={noop}
        onChangeSolo={noop}
        onRemoveSolo={noop}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Start a team' }));
    await user.click(screen.getByRole('button', { name: 'Start team' }));
    expect(createTeamMock).toHaveBeenCalledWith({ year: 2027, seriesId: 'monday-campbell-cave-teams' });
    expect(onNotice).toHaveBeenCalledWith('Team started.');
  });

  it('lists other teams read-only', () => {
    render(
      <TeamPanel
        year={2027}
        series={series()}
        session={session()}
        role={{ kind: 'notOnTeam', solo: null }}
        team={null}
        otherTeams={[team({ id: 'other', name: 'Smith team', captainMemberId: 'member-b', status: 'active' })]}
        sessionEntries={[]}
        member={member()}
        members={members}
        nameOf={nameOf}
        visitors={[]}
        onNotice={noop}
        onSolo={noop}
        onChangeSolo={noop}
        onRemoveSolo={noop}
      />,
    );
    expect(screen.getByText(/Smith team/)).toBeTruthy();
    expect(screen.getByText(/captain John Smith/)).toBeTruthy();
  });
});

describe('TeamPanel: plain member', () => {
  it('leaves the team on confirm', async () => {
    leaveTeamMock.mockResolvedValueOnce({ team: team() });
    const onNotice = vi.fn();
    const user = userEvent.setup();
    render(
      <TeamPanel
        year={2027}
        series={series()}
        session={session()}
        role={{ kind: 'member' }}
        team={team()}
        otherTeams={[]}
        sessionEntries={[]}
        member={member({ id: 'member-b' })}
        members={members}
        nameOf={nameOf}
        visitors={[]}
        onNotice={onNotice}
        onSolo={noop}
        onChangeSolo={noop}
        onRemoveSolo={noop}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Leave team' }));
    await user.click(screen.getByRole('dialog').querySelector('button.button-danger')!);
    expect(leaveTeamMock).toHaveBeenCalledWith({ teamId: team().id });
    expect(onNotice).toHaveBeenCalledWith("You've left the team.");
  });

  it('does not offer captain-only actions', () => {
    render(
      <TeamPanel
        year={2027}
        series={series()}
        session={session()}
        role={{ kind: 'member' }}
        team={team()}
        otherTeams={[]}
        sessionEntries={[]}
        member={member({ id: 'member-b' })}
        members={members}
        nameOf={nameOf}
        visitors={[]}
        onNotice={noop}
        onSolo={noop}
        onChangeSolo={noop}
        onRemoveSolo={noop}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Invite a member' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disband team' })).toBeNull();
  });
});

describe('TeamPanel: captain', () => {
  it('invites a member', async () => {
    inviteToTeamMock.mockResolvedValueOnce({ invite: {} });
    const onNotice = vi.fn();
    const user = userEvent.setup();
    render(
      <TeamPanel
        year={2027}
        series={series()}
        session={session()}
        role={{ kind: 'captain', full: false, hasAbsence: false }}
        team={team()}
        otherTeams={[]}
        sessionEntries={[]}
        member={member()}
        members={members}
        nameOf={nameOf}
        visitors={[]}
        onNotice={onNotice}
        onSolo={noop}
        onChangeSolo={noop}
        onRemoveSolo={noop}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Invite a member' }));
    await user.click(screen.getByRole('button', { name: /Amy Lee/ }));
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(inviteToTeamMock).toHaveBeenCalledWith({ teamId: team().id, toMemberId: 'member-c' });
    expect(onNotice).toHaveBeenCalledWith('Invite sent.');
  });

  it('removes a member on confirm', async () => {
    removeFromTeamMock.mockResolvedValueOnce({ team: team() });
    const onNotice = vi.fn();
    const user = userEvent.setup();
    render(
      <TeamPanel
        year={2027}
        series={series()}
        session={session()}
        role={{ kind: 'captain', full: false, hasAbsence: false }}
        team={team()}
        otherTeams={[]}
        sessionEntries={[]}
        member={member()}
        members={members}
        nameOf={nameOf}
        visitors={[]}
        onNotice={onNotice}
        onSolo={noop}
        onChangeSolo={noop}
        onRemoveSolo={noop}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('dialog').querySelector('button.button-danger')!);
    expect(removeFromTeamMock).toHaveBeenCalledWith({ teamId: team().id, ref: { kind: 'member', memberId: 'member-b' } });
    expect(onNotice).toHaveBeenCalledWith('John Smith was removed from the team.');
  });

  it('disbands the team on confirm', async () => {
    disbandTeamMock.mockResolvedValueOnce({ team: team() });
    const onNotice = vi.fn();
    const user = userEvent.setup();
    render(
      <TeamPanel
        year={2027}
        series={series()}
        session={session()}
        role={{ kind: 'captain', full: false, hasAbsence: false }}
        team={team()}
        otherTeams={[]}
        sessionEntries={[]}
        member={member()}
        members={members}
        nameOf={nameOf}
        visitors={[]}
        onNotice={onNotice}
        onSolo={noop}
        onChangeSolo={noop}
        onRemoveSolo={noop}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Disband team' }));
    await user.click(screen.getByRole('dialog').querySelector('button.button-danger')!);
    expect(disbandTeamMock).toHaveBeenCalledWith({ teamId: team().id });
    expect(onNotice).toHaveBeenCalledWith('Team disbanded.');
  });

  it('disables "Add a substitute for this session" when nobody is absent, enables it when hasAbsence', () => {
    const { rerender } = render(
      <TeamPanel
        year={2027}
        series={series()}
        session={session()}
        role={{ kind: 'captain', full: false, hasAbsence: false }}
        team={team()}
        otherTeams={[]}
        sessionEntries={[]}
        member={member()}
        members={members}
        nameOf={nameOf}
        visitors={[]}
        onNotice={noop}
        onSolo={noop}
        onChangeSolo={noop}
        onRemoveSolo={noop}
      />,
    );
    expect((screen.getByRole('button', { name: 'Add a substitute for this session' }) as HTMLButtonElement).disabled).toBe(true);

    rerender(
      <TeamPanel
        year={2027}
        series={series()}
        session={session()}
        role={{ kind: 'captain', full: false, hasAbsence: true }}
        team={team()}
        otherTeams={[]}
        sessionEntries={[]}
        member={member()}
        members={members}
        nameOf={nameOf}
        visitors={[]}
        onNotice={noop}
        onSolo={noop}
        onChangeSolo={noop}
        onRemoveSolo={noop}
      />,
    );
    expect((screen.getByRole('button', { name: 'Add a substitute for this session' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

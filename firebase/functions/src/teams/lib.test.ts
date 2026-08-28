/**
 * Plain unit tests (no emulator) for the pure helpers in `teams/lib.ts`.
 * Everything else in that file takes a Firestore transaction and is covered
 * indirectly by the `.emu.test.ts` suites in `teams/__tests__/` instead.
 */
import { describe, expect, it } from 'vitest';
import type { Series, Team } from '@obc/shared';
import { refreshTeamStatus, teamId } from './lib.js';

describe('teamId', () => {
  it('joins seriesId and captainMemberId with a hyphen', () => {
    expect(teamId('monday-pairs-2027', 'captain-1')).toBe('monday-pairs-2027-captain-1');
  });

  it('is the only way the id is built — same inputs, same id, every time', () => {
    expect(teamId('s1', 'c1')).toBe(teamId('s1', 'c1'));
  });
});

describe('refreshTeamStatus', () => {
  const series: Series = {
    id: 'ser1',
    weekday: 'monday',
    name: 'Test Teams Series',
    scoring: 'Scr',
    format: 'Teams',
    bestOf: null,
    allowSubstitute: true,
    order: 0,
    sessionIds: ['s1'],
    teamMin: 4,
    teamMax: 6,
    createdAt: 'now',
    updatedAt: 'now',
  };

  function makeTeam(memberCount: number, status: Team['status'] = 'forming'): Team {
    return {
      id: 't1',
      year: 2027,
      seriesId: 'ser1',
      name: 'Test team',
      captainMemberId: 'captain',
      members: Array.from({ length: memberCount }, (_, i) => ({
        ref: { kind: 'member', memberId: `m${i}`, displayName: `Member ${i}` },
        joinedAt: 'now',
      })),
      status,
      createdAt: 'now',
      updatedAt: 'now',
    };
  }

  it("is 'forming' below teamMin", () => {
    expect(refreshTeamStatus(makeTeam(3), series)).toBe('forming');
  });

  it("is 'active' at or above teamMin", () => {
    expect(refreshTeamStatus(makeTeam(4), series)).toBe('active');
    expect(refreshTeamStatus(makeTeam(6), series)).toBe('active');
  });

  it('never revives a disbanded team', () => {
    expect(refreshTeamStatus(makeTeam(6, 'disbanded'), series)).toBe('disbanded');
  });
});

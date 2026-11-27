/**
 * Club-scoped callables carry the current club (plan §21 B14, stage 1a);
 * person-level ones never do — their server schemas are strict and would
 * reject an unexpected `clubId`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CLUB_ID } from '@obc/shared';

const sent: Array<{ name: string; input: unknown }> = [];

vi.mock('./firebase', () => ({
  callable: (name: string) => async (input: unknown) => {
    sent.push({ name, input });
    return {};
  },
}));

import { cancelEntry, removePassword, setCurrentClubId, updateMyPrefs } from './api';

beforeEach(() => {
  sent.length = 0;
  setCurrentClubId(DEFAULT_CLUB_ID);
});

describe('api club scoping', () => {
  it('adds the current club to a club-scoped callable', async () => {
    await cancelEntry({ entryId: 'e1' });
    expect(sent).toEqual([{ name: 'cancelEntry', input: { entryId: 'e1', clubId: DEFAULT_CLUB_ID } }]);
  });

  it('follows the current club, and an explicit clubId wins over it', async () => {
    setCurrentClubId('another-club');
    await cancelEntry({ entryId: 'e1' });
    await cancelEntry({ entryId: 'e2', clubId: 'third-club' });
    expect(sent.map((s) => (s.input as { clubId: string }).clubId)).toEqual(['another-club', 'third-club']);
  });

  it('sends no clubId with person-level callables', async () => {
    await removePassword({});
    await updateMyPrefs({
      push: true,
      email: true,
      reminders: true,
      matchmakingAlerts: false,
      digest: 'immediate',
      reminderDaysBefore: 2,
    });
    for (const s of sent) expect(s.input).not.toHaveProperty('clubId');
  });
});

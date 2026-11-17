import { afterEach, describe, expect, it, vi } from 'vitest';

const batches: Array<{ sets: Array<{ path: string; data: Record<string, unknown>; opts: unknown }>; committed: boolean }> = [];

vi.mock('../firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, path: string) => ({ path }),
  writeBatch: () => {
    const b = { sets: [] as Array<{ path: string; data: Record<string, unknown>; opts: unknown }>, committed: false };
    batches.push(b);
    return {
      set: (ref: { path: string }, data: Record<string, unknown>, opts: unknown) => b.sets.push({ path: ref.path, data, opts }),
      commit: async () => {
        b.committed = true;
      },
    };
  },
}));

import { markNotificationsRead } from './markRead';

afterEach(() => {
  batches.length = 0;
});

describe('markNotificationsRead (direct client write)', () => {
  it('writes read=true and an ISO readAt to each notification, merged, in one batch', async () => {
    await markNotificationsRead(['n1', 'n2', 'n1']);
    expect(batches).toHaveLength(1);
    const b = batches[0];
    if (!b) throw new Error('unreachable: one batch expected');
    expect(b.committed).toBe(true);
    expect(b.sets.map((s) => s.path)).toEqual(['notifications/n1', 'notifications/n2']);
    for (const s of b.sets) {
      expect(s.data.read).toBe(true);
      expect(typeof s.data.readAt).toBe('string');
      expect((s.data.readAt as string).length).toBeLessThanOrEqual(40); // rules cap readAt at 40 chars
      expect(Object.keys(s.data).sort()).toEqual(['read', 'readAt']); // rules: only these two keys may change
      expect(s.opts).toEqual({ merge: true });
    }
  });

  it('splits more than 400 ids across batches', async () => {
    await markNotificationsRead(Array.from({ length: 401 }, (_, i) => `n${i}`));
    expect(batches.map((b) => b.sets.length)).toEqual([400, 1]);
    expect(batches.every((b) => b.committed)).toBe(true);
  });

  it('does nothing for an empty list', async () => {
    await markNotificationsRead([]);
    expect(batches).toHaveLength(0);
  });
});

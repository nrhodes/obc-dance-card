import { describe, expect, it } from 'vitest';
import { paths, type Notification } from '@obc/shared';
import { db } from '../lib/admin.js';
import { fakeCallableRequest, makeMember } from '../testing/fixtures.js';
import { markNotificationsReadHandler } from './read.js';

async function makeNotification(memberId: string, id: string): Promise<Notification> {
  const now = new Date().toISOString();
  const notification: Notification = {
    id,
    memberId,
    type: 'broadcast',
    title: 'Test',
    body: 'Test body',
    data: {},
    channelsSent: ['inapp'],
    read: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.doc(paths.notification(id)).set(notification);
  return notification;
}

describe('markNotificationsRead', () => {
  it('marks the caller’s own notifications read', async () => {
    const m = await makeMember('mnr-own@example.org');
    await makeNotification(m, 'mnr-1');
    await makeNotification(m, 'mnr-2');

    await markNotificationsReadHandler(fakeCallableRequest({ ids: ['mnr-1', 'mnr-2'] }, { uid: m }));

    const snap1 = await db.doc(paths.notification('mnr-1')).get();
    const snap2 = await db.doc(paths.notification('mnr-2')).get();
    expect((snap1.data() as Notification).read).toBe(true);
    expect((snap1.data() as Notification).readAt).toBeTruthy();
    expect((snap2.data() as Notification).read).toBe(true);
  });

  it('silently ignores ids belonging to another member', async () => {
    const owner = await makeMember('mnr-owner@example.org');
    const intruder = await makeMember('mnr-intruder@example.org');
    await makeNotification(owner, 'mnr-3');

    await expect(
      markNotificationsReadHandler(fakeCallableRequest({ ids: ['mnr-3'] }, { uid: intruder })),
    ).resolves.toEqual({ ok: true });

    const snap = await db.doc(paths.notification('mnr-3')).get();
    expect((snap.data() as Notification).read).toBe(false);
  });

  it('silently ignores an id that does not exist', async () => {
    const m = await makeMember('mnr-missing@example.org');
    await expect(
      markNotificationsReadHandler(fakeCallableRequest({ ids: ['does-not-exist'] }, { uid: m })),
    ).resolves.toEqual({ ok: true });
  });
});

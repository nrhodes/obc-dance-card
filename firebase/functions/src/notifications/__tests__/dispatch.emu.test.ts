import { describe, expect, it } from 'vitest';
import { paths, type MemberPrivate, type Notification, type NotificationPrefs, type RegisteredDevice } from '@obc/shared';
import { db } from '../../lib/admin.js';
import { makeMember } from '../../testing/fixtures.js';
import { createNotification } from '../create.js';
import { dispatchNotification, type PushProvider, type PushSendResult } from '../dispatch.js';

async function setPrefs(memberId: string, patch: Partial<NotificationPrefs>): Promise<void> {
  const snap = await db.doc(paths.memberPrivate(memberId)).get();
  const mp = snap.data() as MemberPrivate;
  await db
    .doc(paths.memberPrivate(memberId))
    .set({ notificationPrefs: { ...mp.notificationPrefs, ...patch } }, { merge: true });
}

async function setDevices(memberId: string, devices: RegisteredDevice[]): Promise<void> {
  await db.doc(paths.memberPrivate(memberId)).set({ devices }, { merge: true });
}

async function outboxFor(to: string, kind: 'push' | 'email'): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const snap = await db.collection('emulatorOutbox').where('to', '==', to).where('kind', '==', kind).get();
  return snap.docs;
}

async function readNotification(id: string): Promise<Notification> {
  const snap = await db.doc(paths.notification(id)).get();
  return snap.data() as Notification;
}

const device = (token: string): RegisteredDevice => ({ token, platform: 'web', lastSeenAt: new Date().toISOString() });

describe('dispatchNotification', () => {
  it('push+email immediate: outbox gets one push and one email doc; channelsSent ends inapp,push,email', async () => {
    const m = await makeMember('dispatch-both@example.org');
    await setDevices(m, [device('dispatch-both-token')]);

    const notification = await createNotification(m, 'claimed', 'Someone claimed your listing', 'Alice will play with you.');
    await dispatchNotification(notification.id);

    const updated = await readNotification(notification.id);
    expect(updated.channelsSent).toEqual(['inapp', 'push', 'email']);

    const pushDocs = await outboxFor(m, 'push');
    expect(pushDocs).toHaveLength(1);
    expect(pushDocs[0]!.data().title).toBe('Someone claimed your listing');

    const emailDocs = await outboxFor('dispatch-both@example.org', 'email');
    expect(emailDocs).toHaveLength(1);
    expect(emailDocs[0]!.data().text).toContain('Alice will play with you.');
  });

  it('is idempotent: re-invoking on the same doc sends nothing more', async () => {
    const m = await makeMember('dispatch-idempotent@example.org');
    await setDevices(m, [device('dispatch-idempotent-token')]);

    const notification = await createNotification(m, 'claimed', 'Title', 'Body');
    await dispatchNotification(notification.id);
    await dispatchNotification(notification.id);
    await dispatchNotification(notification.id);

    const updated = await readNotification(notification.id);
    expect(updated.channelsSent).toEqual(['inapp', 'push', 'email']);
    expect(await outboxFor(m, 'push')).toHaveLength(1);
    expect(await outboxFor('dispatch-idempotent@example.org', 'email')).toHaveLength(1);
  });

  it('prefs.email off: no email is sent', async () => {
    const m = await makeMember('dispatch-noemail@example.org');
    await setPrefs(m, { email: false });
    await setDevices(m, [device('dispatch-noemail-token')]);

    const notification = await createNotification(m, 'claimed', 'Title', 'Body');
    await dispatchNotification(notification.id);

    const updated = await readNotification(notification.id);
    expect(updated.channelsSent).toEqual(['inapp', 'push']);
    expect(await outboxFor('dispatch-noemail@example.org', 'email')).toHaveLength(0);
  });

  it('digest daily: an ordinary notification does not email immediately', async () => {
    const m = await makeMember('dispatch-digest-daily@example.org');
    await setPrefs(m, { digest: 'daily', push: false });

    const notification = await createNotification(m, 'claimed', 'Title', 'Body');
    await dispatchNotification(notification.id);

    const updated = await readNotification(notification.id);
    expect(updated.channelsSent).toEqual(['inapp']);
  });

  it.each(['security', 'broadcast', 'on_behalf_action'] as const)(
    'digest daily: a %s notification still emails immediately',
    async (type) => {
      const m = await makeMember(`dispatch-digest-always-${type}@example.org`);
      await setPrefs(m, { digest: 'daily', push: false });

      const notification = await createNotification(m, type, 'Title', 'Body');
      await dispatchNotification(notification.id);

      const updated = await readNotification(notification.id);
      expect(updated.channelsSent).toEqual(['inapp', 'email']);
    },
  );

  it('no devices: no push is sent', async () => {
    const m = await makeMember('dispatch-nodevices@example.org');

    const notification = await createNotification(m, 'claimed', 'Title', 'Body');
    await dispatchNotification(notification.id);

    const updated = await readNotification(notification.id);
    expect(updated.channelsSent).toEqual(['inapp', 'email']);
  });

  it('prunes only the dead token a PushProvider reports as unregistered', async () => {
    const m = await makeMember('dispatch-prune@example.org');
    await setDevices(m, [device('keep-me'), device('drop-me')]);
    await setPrefs(m, { email: false });

    const fakeProvider: PushProvider = {
      async send(): Promise<PushSendResult> {
        return { invalidTokens: ['drop-me'] };
      },
    };

    const notification = await createNotification(m, 'claimed', 'Title', 'Body');
    await dispatchNotification(notification.id, { pushProvider: fakeProvider });

    const updated = await readNotification(notification.id);
    expect(updated.channelsSent).toEqual(['inapp', 'push']);

    const mpSnap = await db.doc(paths.memberPrivate(m)).get();
    const mp = mpSnap.data() as MemberPrivate;
    expect(mp.devices.map((d) => d.token)).toEqual(['keep-me']);
  });
});

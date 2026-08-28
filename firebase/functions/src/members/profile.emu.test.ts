import { describe, expect, it } from 'vitest';
import type { MemberPrivate, RegisterDeviceInput } from '@obc/shared';
import { paths } from '@obc/shared';
import { auth, db } from '../lib/admin.js';
import { fakeCallableRequest, makeMember } from '../testing/fixtures.js';
import { registerDeviceHandler } from './profile.js';
import { removePasswordHandler } from '../auth/password.js';

describe('registerDevice', () => {
  it('caps at 10 devices and evicts the oldest by lastSeenAt', async () => {
    const uid = await makeMember('devices@example.org');

    // Seed 10 devices with strictly increasing lastSeenAt, oldest first.
    const base = Date.now() - 100_000;
    const devices = Array.from({ length: 10 }, (_, i) => ({
      token: `token-${i}`,
      platform: 'web' as const,
      lastSeenAt: new Date(base + i * 1000).toISOString(),
    }));
    await db.doc(paths.memberPrivate(uid)).set({ devices }, { merge: true });

    await registerDeviceHandler(fakeCallableRequest<RegisterDeviceInput>({ token: 'token-new', platform: 'ios' }, { uid }));

    const snap = await db.doc(paths.memberPrivate(uid)).get();
    const data = snap.data() as MemberPrivate;
    expect(data.devices).toHaveLength(10);
    expect(data.devices.find((d) => d.token === 'token-0')).toBeUndefined(); // oldest evicted
    expect(data.devices.find((d) => d.token === 'token-new')).toBeTruthy();
    // The other 9 originals survive.
    for (let i = 1; i < 10; i++) {
      expect(data.devices.find((d) => d.token === `token-${i}`)).toBeTruthy();
    }
  });

  it('re-registering an existing token updates it in place instead of growing the list', async () => {
    const uid = await makeMember('devices2@example.org');
    await registerDeviceHandler(fakeCallableRequest<RegisterDeviceInput>({ token: 'same', platform: 'web' }, { uid }));
    await registerDeviceHandler(
      fakeCallableRequest<RegisterDeviceInput>({ token: 'same', platform: 'web', label: 'updated' }, { uid }),
    );

    const snap = await db.doc(paths.memberPrivate(uid)).get();
    const data = snap.data() as MemberPrivate;
    expect(data.devices).toHaveLength(1);
    expect(data.devices[0]?.label).toBe('updated');
  });
});

describe('removePassword', () => {
  it('sets hasPassword=false while the Auth user still exists', async () => {
    const uid = await makeMember('removepw@example.org', { hasPassword: true });

    await removePasswordHandler(fakeCallableRequest({}, { uid }));

    const snap = await db.doc(paths.memberPrivate(uid)).get();
    expect((snap.data() as MemberPrivate).hasPassword).toBe(false);

    const userRecord = await auth.getUser(uid);
    expect(userRecord.uid).toBe(uid);
    expect(userRecord.disabled).toBe(false);
  });
});

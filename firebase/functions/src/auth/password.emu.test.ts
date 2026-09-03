import { describe, expect, it } from 'vitest';
import type { MemberPrivate, SetPasswordInput } from '@obc/shared';
import { paths } from '@obc/shared';
import { auth, db } from '../lib/admin.js';
import { fakeCallableRequest, makeMember } from '../testing/fixtures.js';
import { setPasswordHandler } from './password.js';

describe('setPassword', () => {
  it('sets a password server-side, links the password provider, and flags hasPassword', async () => {
    const uid = await makeMember('setpw@example.org');
    await setPasswordHandler(fakeCallableRequest<SetPasswordInput>({ password: 'goodpass1' }, { uid }));

    const user = await auth.getUser(uid);
    expect(user.providerData.some((p) => p.providerId === 'password')).toBe(true);
    const priv = (await db.doc(paths.memberPrivate(uid)).get()).data() as MemberPrivate;
    expect(priv.hasPassword).toBe(true);
  });

  it('rejects a weak password with invalid-argument and does not set it', async () => {
    const uid = await makeMember('weakpw@example.org');
    await expect(
      setPasswordHandler(fakeCallableRequest<SetPasswordInput>({ password: 'short' }, { uid })),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    const user = await auth.getUser(uid);
    expect(user.providerData.some((p) => p.providerId === 'password')).toBe(false);
  });

  it('requires a signed-in member', async () => {
    await expect(
      setPasswordHandler(fakeCallableRequest<SetPasswordInput>({ password: 'goodpass1' }, {})),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});

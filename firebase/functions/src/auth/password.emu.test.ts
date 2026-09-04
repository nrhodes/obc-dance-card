import { describe, expect, it } from 'vitest';
import type { MemberPrivate, SetPasswordInput } from '@obc/shared';
import { RECENT_LOGIN_REQUIRED_REASON, paths } from '@obc/shared';
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

  it('succeeds with a fresh auth_time (just signed in)', async () => {
    const uid = await makeMember('freshpw@example.org');
    const authTimeSeconds = Math.floor(Date.now() / 1000); // just now
    await setPasswordHandler(
      fakeCallableRequest<SetPasswordInput>({ password: 'goodpass1' }, { uid, authTimeSeconds }),
    );
    const user = await auth.getUser(uid);
    expect(user.providerData.some((p) => p.providerId === 'password')).toBe(true);
  });

  it('rejects a stale auth_time (audit M1: recent-login-required) without touching the account', async () => {
    const uid = await makeMember('stalepw@example.org');
    const staleAuthTimeSeconds = Math.floor(Date.now() / 1000) - 11 * 60; // 11 minutes ago
    await expect(
      setPasswordHandler(
        fakeCallableRequest<SetPasswordInput>({ password: 'goodpass1' }, { uid, authTimeSeconds: staleAuthTimeSeconds }),
      ),
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: RECENT_LOGIN_REQUIRED_REASON },
    });
    const user = await auth.getUser(uid);
    expect(user.providerData.some((p) => p.providerId === 'password')).toBe(false);
  });

  it('succeeds again after a (conceptual) re-auth refreshes auth_time', async () => {
    const uid = await makeMember('retrypw@example.org');
    const staleAuthTimeSeconds = Math.floor(Date.now() / 1000) - 15 * 60;
    await expect(
      setPasswordHandler(
        fakeCallableRequest<SetPasswordInput>({ password: 'goodpass1' }, { uid, authTimeSeconds: staleAuthTimeSeconds }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    // Client re-authenticates inline (requestLoginCode + verifyLoginCode +
    // signInWithCustomToken) and retries with the same kept password; the
    // new session's auth_time is fresh.
    const freshAuthTimeSeconds = Math.floor(Date.now() / 1000);
    await setPasswordHandler(
      fakeCallableRequest<SetPasswordInput>({ password: 'goodpass1' }, { uid, authTimeSeconds: freshAuthTimeSeconds }),
    );
    const user = await auth.getUser(uid);
    expect(user.providerData.some((p) => p.providerId === 'password')).toBe(true);
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

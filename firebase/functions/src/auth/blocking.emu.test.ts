import { describe, expect, it } from 'vitest';
import type { AuthBlockingEvent } from 'firebase-functions/v2/identity';
import { auth } from '../lib/admin.js';
import { makeMember } from '../testing/fixtures.js';
import { beforeSignInHandler, beforeUserCreatedHandler } from './blocking.js';

function fakeEvent(uid: string | undefined): AuthBlockingEvent {
  return { data: uid ? { uid } : undefined } as unknown as AuthBlockingEvent;
}

describe('beforeUserCreated / beforeSignIn blocking handlers', () => {
  it('beforeUserCreated always denies', () => {
    expect(() => beforeUserCreatedHandler()).toThrowError(
      expect.objectContaining({ code: 'permission-denied' }),
    );
  });

  it('beforeSignIn denies when the event carries no uid', async () => {
    await expect(beforeSignInHandler(fakeEvent(undefined))).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('beforeSignIn denies when members/{uid} does not exist', async () => {
    const user = await auth.createUser({ email: 'blocking-missing@example.org' });
    await expect(beforeSignInHandler(fakeEvent(user.uid))).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('beforeSignIn denies an inactive member', async () => {
    const uid = await makeMember('blocking-inactive@example.org', { active: false });
    await expect(beforeSignInHandler(fakeEvent(uid))).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('beforeSignIn allows an active member', async () => {
    const uid = await makeMember('blocking-active@example.org', { active: true });
    await expect(beforeSignInHandler(fakeEvent(uid))).resolves.toBeUndefined();
  });
});

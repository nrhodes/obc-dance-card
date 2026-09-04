import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type {
  CreateIcalFeedInput,
  GetIcalFeedInput,
  IcalToken,
  MemberPrivate,
  RemoveIcalFeedInput,
  RotateIcalFeedInput,
} from '@obc/shared';
import { paths } from '@obc/shared';
import { db } from '../../lib/admin.js';
import { fakeCallableRequest, makeMember, notificationsFor } from '../../testing/fixtures.js';
import {
  createIcalFeedHandler,
  getIcalFeedHandler,
  removeIcalFeedHandler,
  rotateIcalFeedHandler,
} from '../tokens.js';

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function tokenFromUrl(url: string): string {
  const match = /\/ical\/([^/]+)\.ics$/.exec(url);
  if (!match) throw new Error(`could not extract token from url: ${url}`);
  return match[1]!;
}

describe('getIcalFeed / createIcalFeed / rotateIcalFeed / removeIcalFeed (plan §21 B1)', () => {
  it('the full create -> get -> rotate -> remove lifecycle', async () => {
    const uid = await makeMember('ical-lifecycle@example.org');

    // No feed yet.
    const before = await getIcalFeedHandler(fakeCallableRequest<GetIcalFeedInput>({}, { uid }));
    expect(before).toEqual({ url: null });

    // Create.
    const created = await createIcalFeedHandler(fakeCallableRequest<CreateIcalFeedInput>({}, { uid }));
    expect(created.url).toMatch(/\/ical\/.+\.ics$/);
    expect(created.webcalUrl.startsWith('webcal:')).toBe(true);
    const token1 = tokenFromUrl(created.url);
    expect(token1).toHaveLength(43);

    const privateSnap1 = await db.doc(paths.memberPrivate(uid)).get();
    const private1 = privateSnap1.data() as MemberPrivate;
    expect(private1.icalToken).toBe(token1);
    expect(private1.icalTokenCreatedAt).toBeTruthy();

    const tokenDocSnap1 = await db.doc(paths.icalToken(sha256Hex(token1))).get();
    expect(tokenDocSnap1.exists).toBe(true);
    expect((tokenDocSnap1.data() as IcalToken).memberId).toBe(uid);

    // Creating again is rejected.
    await expect(createIcalFeedHandler(fakeCallableRequest<CreateIcalFeedInput>({}, { uid }))).rejects.toMatchObject({
      code: 'failed-precondition',
    });

    // Get now returns the same URL.
    const got = await getIcalFeedHandler(fakeCallableRequest<GetIcalFeedInput>({}, { uid }));
    expect(got).toMatchObject({ url: created.url, webcalUrl: created.webcalUrl });

    // Rotate: new token, old lookup doc gone.
    const rotated = await rotateIcalFeedHandler(fakeCallableRequest<RotateIcalFeedInput>({}, { uid }));
    const token2 = tokenFromUrl(rotated.url);
    expect(token2).not.toBe(token1);

    const oldTokenDocSnap = await db.doc(paths.icalToken(sha256Hex(token1))).get();
    expect(oldTokenDocSnap.exists).toBe(false);
    const newTokenDocSnap = await db.doc(paths.icalToken(sha256Hex(token2))).get();
    expect(newTokenDocSnap.exists).toBe(true);
    expect((newTokenDocSnap.data() as IcalToken).memberId).toBe(uid);

    const privateSnap2 = await db.doc(paths.memberPrivate(uid)).get();
    expect((privateSnap2.data() as MemberPrivate).icalToken).toBe(token2);

    // Remove: both docs gone.
    const removed = await removeIcalFeedHandler(fakeCallableRequest<RemoveIcalFeedInput>({}, { uid }));
    expect(removed).toEqual({ ok: true });

    const privateSnap3 = await db.doc(paths.memberPrivate(uid)).get();
    expect((privateSnap3.data() as MemberPrivate).icalToken).toBeUndefined();
    const tokenDocSnap2 = await db.doc(paths.icalToken(sha256Hex(token2))).get();
    expect(tokenDocSnap2.exists).toBe(false);

    // Removing again is a no-op, not an error.
    await expect(removeIcalFeedHandler(fakeCallableRequest<RemoveIcalFeedInput>({}, { uid }))).resolves.toEqual({
      ok: true,
    });

    // And getIcalFeed is back to null.
    const after = await getIcalFeedHandler(fakeCallableRequest<GetIcalFeedInput>({}, { uid }));
    expect(after).toEqual({ url: null });
  });

  it('rotateIcalFeed with no existing feed is rejected', async () => {
    const uid = await makeMember('ical-rotate-none@example.org');
    await expect(rotateIcalFeedHandler(fakeCallableRequest<RotateIcalFeedInput>({}, { uid }))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('sends a `security` notification on create/rotate/remove, self-service (no audit, no on-behalf notice)', async () => {
    const uid = await makeMember('ical-security-notice@example.org');

    await createIcalFeedHandler(fakeCallableRequest<CreateIcalFeedInput>({}, { uid }));
    expect(await notificationsFor(uid, 'security')).toHaveLength(1);
    expect(await notificationsFor(uid, 'on_behalf_action')).toHaveLength(0);

    await rotateIcalFeedHandler(fakeCallableRequest<RotateIcalFeedInput>({}, { uid }));
    expect(await notificationsFor(uid, 'security')).toHaveLength(2);

    await removeIcalFeedHandler(fakeCallableRequest<RemoveIcalFeedInput>({}, { uid }));
    expect(await notificationsFor(uid, 'security')).toHaveLength(3);
    expect(await notificationsFor(uid, 'on_behalf_action')).toHaveLength(0);

    const auditSnap = await db
      .collection(paths.auditLog())
      .where('targetMemberId', '==', uid)
      .get();
    expect(auditSnap.empty).toBe(true);
  });

  it('on-behalf create/get/rotate/remove: audits, notifies the member with on_behalf_action, and still sends the security notice', async () => {
    const admin = await makeMember('ical-admin@example.org', { role: 'admin' });
    const member = await makeMember('ical-onbehalf@example.org');

    const created = await createIcalFeedHandler(
      fakeCallableRequest<CreateIcalFeedInput>({ onBehalfOfMemberId: member }, { uid: admin }),
    );
    expect(created.url).toMatch(/\/ical\/.+\.ics$/);

    await getIcalFeedHandler(fakeCallableRequest<GetIcalFeedInput>({ onBehalfOfMemberId: member }, { uid: admin }));
    await rotateIcalFeedHandler(fakeCallableRequest<RotateIcalFeedInput>({ onBehalfOfMemberId: member }, { uid: admin }));
    await removeIcalFeedHandler(fakeCallableRequest<RemoveIcalFeedInput>({ onBehalfOfMemberId: member }, { uid: admin }));

    const actions = ['create_ical_feed_on_behalf', 'get_ical_feed_on_behalf', 'rotate_ical_feed_on_behalf', 'remove_ical_feed_on_behalf'];
    for (const action of actions) {
      const snap = await db.collection(paths.auditLog()).where('action', '==', action).get();
      expect(snap.docs.some((d) => d.data().actorMemberId === admin && d.data().targetMemberId === member), action).toBe(
        true,
      );
    }

    // One `on_behalf_action` per admin call (create/get/rotate/remove = 4), plus
    // the domain `security` notices for create/rotate/remove (create, rotate,
    // remove = 3; getIcalFeed sends no `security` notice — it never mutates).
    expect(await notificationsFor(member, 'on_behalf_action')).toHaveLength(4);
    expect(await notificationsFor(member, 'security')).toHaveLength(3);
  });
});

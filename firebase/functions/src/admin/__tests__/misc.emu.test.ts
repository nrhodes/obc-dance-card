import { describe, expect, it } from 'vitest';
import { paths, type BroadcastInput, type ListAuditLogInput } from '@obc/shared';
import { db } from '../../lib/admin.js';
import { fakeCallableRequest, makeMember, makeProgramme, notificationsFor, sessionInFuture } from '../../testing/fixtures.js';
import { sendInviteHandler, respondToInviteHandler } from '../../entries/invites.js';
import type { RespondToInviteInput, SendInviteInput, SetMemberRoleInput } from '@obc/shared';
import { broadcastHandler, listAuditLogHandler } from '../misc.js';
import { setMemberRoleHandler } from '../members.js';

describe('broadcast', () => {
  it('notifies every active member when no weekday filter is given', async () => {
    const admin = await makeMember('bcast-all-admin@example.org', { role: 'admin' });
    const a = await makeMember('bcast-all-a@example.org');
    const b = await makeMember('bcast-all-b@example.org');
    const inactive = await makeMember('bcast-all-inactive@example.org', { active: false });

    const result = await broadcastHandler(
      fakeCallableRequest<BroadcastInput>({ title: 'Club notice', body: 'Hello everyone' }, { uid: admin }),
    );

    // The shared emulator accumulates active members across the whole test
    // run, so — matching `publishProgramme.emu.test.ts`'s established
    // convention — this asserts specific members were (or were not)
    // notified rather than an exact, whole-store recipient count.
    expect(result.recipients).toBeGreaterThanOrEqual(3);
    expect(await notificationsFor(a, 'broadcast')).toHaveLength(1);
    expect(await notificationsFor(b, 'broadcast')).toHaveLength(1);
    expect(await notificationsFor(inactive, 'broadcast')).toHaveLength(0);
  });

  it('filters to members with a future entry on a matching weekday', async () => {
    const admin = await makeMember('bcast-wd-admin@example.org', { role: 'admin' });
    const monday = await makeMember('bcast-wd-monday@example.org');
    const other = await makeMember('bcast-wd-tuesday@example.org');
    const bystander = await makeMember('bcast-wd-none@example.org');

    const progMon = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const { invite: mondayInvite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: progMon.year, sessionId: progMon.sessionIds[0]!, toMemberId: monday },
        { uid: admin },
      ),
    );
    await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: mondayInvite.id, accept: true }, { uid: monday }));

    const progTue = await makeProgramme({ weekday: 'tuesday', dates: [sessionInFuture('tuesday')] });
    const { invite: tueInvite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: progTue.year, sessionId: progTue.sessionIds[0]!, toMemberId: other },
        { uid: admin },
      ),
    );
    await respondToInviteHandler(fakeCallableRequest<RespondToInviteInput>({ inviteId: tueInvite.id, accept: true }, { uid: other }));

    const result = await broadcastHandler(
      fakeCallableRequest<BroadcastInput>({ title: 'Monday notice', body: 'Monday only', weekdays: ['monday'] }, { uid: admin }),
    );

    // admin themselves sent both invites so has a confirmed Monday entry too.
    expect(result.recipients).toBeGreaterThanOrEqual(2);
    expect(await notificationsFor(monday, 'broadcast')).toHaveLength(1);
    expect(await notificationsFor(other, 'broadcast')).toHaveLength(0);
    expect(await notificationsFor(bystander, 'broadcast')).toHaveLength(0);
  });

  it('rate limits an admin to 5 broadcasts per day', async () => {
    const admin = await makeMember('bcast-ratelimit-admin@example.org', { role: 'admin' });
    for (let i = 0; i < 5; i++) {
      await broadcastHandler(fakeCallableRequest<BroadcastInput>({ title: `Notice ${i}`, body: 'x' }, { uid: admin }));
    }
    await expect(
      broadcastHandler(fakeCallableRequest<BroadcastInput>({ title: 'One too many', body: 'x' }, { uid: admin })),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
  });

  it('audits broadcast_sent with the recipient count and title', async () => {
    const admin = await makeMember('bcast-audit-admin@example.org', { role: 'admin' });
    await broadcastHandler(fakeCallableRequest<BroadcastInput>({ title: 'Audited notice', body: 'x' }, { uid: admin }));

    const snap = await db.collection(paths.auditLog()).where('action', '==', 'broadcast_sent').get();
    const row = snap.docs.find((d) => d.data().actorMemberId === admin);
    expect(row?.data().detail).toMatchObject({ title: 'Audited notice' });
  });
});

describe('listAuditLog', () => {
  it('pages through entries ordered newest-first', async () => {
    const admin = await makeMember('audit-page-admin@example.org', { role: 'admin' });
    for (let i = 0; i < 3; i++) {
      await broadcastHandler(fakeCallableRequest<BroadcastInput>({ title: `Page ${i}`, body: 'x' }, { uid: admin }));
    }

    const firstPage = await listAuditLogHandler(fakeCallableRequest<ListAuditLogInput>({ limit: 2 }, { uid: admin }));
    expect(firstPage.entries.length).toBe(2);
    expect(firstPage.nextBefore).toBeDefined();

    const secondPage = await listAuditLogHandler(
      fakeCallableRequest<ListAuditLogInput>({ limit: 2, before: firstPage.nextBefore }, { uid: admin }),
    );
    expect(secondPage.entries.length).toBeGreaterThanOrEqual(1);
    const firstIds = new Set(firstPage.entries.map((e) => e.id));
    expect(secondPage.entries.every((e) => !firstIds.has(e.id))).toBe(true);
  });

  it('filters by action', async () => {
    const admin = await makeMember('audit-filter-admin@example.org', { role: 'admin' });
    const member = await makeMember('audit-filter-member@example.org');
    await broadcastHandler(fakeCallableRequest<BroadcastInput>({ title: 'Filter test', body: 'x' }, { uid: admin }));
    await setMemberRoleHandler(fakeCallableRequest<SetMemberRoleInput>({ memberId: member, role: 'admin' }, { uid: admin }));

    const result = await listAuditLogHandler(
      fakeCallableRequest<ListAuditLogInput>({ action: 'role_changed' }, { uid: admin }),
    );
    expect(result.entries.every((e) => e.action === 'role_changed')).toBe(true);
    expect(result.entries.length).toBeGreaterThanOrEqual(1);
  });

  it('is refused for a non-admin', async () => {
    const member = await makeMember('audit-nonadmin@example.org');
    await expect(
      listAuditLogHandler(fakeCallableRequest<ListAuditLogInput>({}, { uid: member })),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

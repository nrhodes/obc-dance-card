import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  addDaysNZ,
  paths,
  todayNZ,
  type Entry,
  type Invite,
  type MemberPrivate,
  type NotificationPrefs,
  type SendInviteInput,
  type SetSoloStatusInput,
} from '@obc/shared';
import { db } from '../../lib/admin.js';
import { setSoloStatusHandler } from '../../entries/entries.js';
import { sendInviteHandler } from '../../entries/invites.js';
import { fakeCallableRequest, makeMember, makeProgramme, notificationsFor } from '../../testing/fixtures.js';
import { createNotification } from '../create.js';
import { runPurgeExpired, runSendDailyDigest, runSendSessionReminders } from '../scheduled.js';

async function setPrefs(memberId: string, patch: Partial<NotificationPrefs>): Promise<void> {
  const ref = db.doc(paths.memberPrivate(memberId));
  const mp = (await ref.get()).data() as MemberPrivate;
  await ref.set({ notificationPrefs: { ...mp.notificationPrefs, ...patch } }, { merge: true });
}

function seedConfirmedEntry(sessionId: string, memberId: string, date: string, seriesId: string | null): Entry {
  const now = new Date().toISOString();
  return {
    id: `${sessionId}_${memberId}`,
    sessionId,
    date,
    weekday: 'monday',
    seriesId,
    memberId,
    status: 'confirmed',
    partner: { kind: 'member', memberId: 'reminder-partner', displayName: 'Reminder Partner' },
    pairingId: randomUUID(),
    teamId: null,
    teamSessionOnly: false,
    substitute: null,
    partnerSubstitute: null,
    isSubstituteFor: null,
    createdBy: memberId,
    createdAt: now,
    updatedAt: now,
  };
}

async function outboxEmailsFor(to: string): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const snap = await db.collection('emulatorOutbox').where('to', '==', to).where('kind', '==', 'email').get();
  return snap.docs;
}

describe('runSendSessionReminders', () => {
  it('reminds an entry exactly reminderDaysBefore ahead, not one further out; does not duplicate on rerun', async () => {
    const m = await makeMember('reminder-member@example.org');
    const now = new Date();
    const today = todayNZ(now);
    // DEFAULT_NOTIFICATION_PREFS.reminderDaysBefore is 2.
    const nearDate = addDaysNZ(today, 2);
    const farDate = addDaysNZ(today, 3);
    const prog = await makeProgramme({ dates: [nearDate, farDate], weekday: 'monday' });
    const nearId = prog.sessionIds[0]!;
    const farId = prog.sessionIds[1]!;

    await db.doc(paths.entry(`${nearId}_${m}`)).set(seedConfirmedEntry(nearId, m, nearDate, prog.seriesId));
    await db.doc(paths.entry(`${farId}_${m}`)).set(seedConfirmedEntry(farId, m, farDate, prog.seriesId));

    const report = await runSendSessionReminders(now);
    expect(report.sent).toBe(1);

    const reminders = await notificationsFor(m, 'session_reminder');
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.data.entryId).toBe(`${nearId}_${m}`);

    await runSendSessionReminders(now);
    expect(await notificationsFor(m, 'session_reminder')).toHaveLength(1);
  });

  // plan §21 B2: `unavailable` is "don't ask me for this session" — no
  // reminder either, exactly like a cancelled entry.
  it('does not remind a member whose entry for that session is unavailable', async () => {
    const m = await makeMember('reminder-unavailable@example.org');
    const now = new Date();
    const nearDate = addDaysNZ(todayNZ(now), 2);
    const prog = await makeProgramme({ dates: [nearDate], weekday: 'monday' });

    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>(
        { year: prog.year, sessionId: prog.sessionIds[0]!, status: 'unavailable' },
        { uid: m },
      ),
    );

    const report = await runSendSessionReminders(now);
    expect(report.sent).toBe(0);
    expect(await notificationsFor(m, 'session_reminder')).toHaveLength(0);
  });

  it('does not remind a member with reminders turned off', async () => {
    const m = await makeMember('reminder-off@example.org');
    await setPrefs(m, { reminders: false });
    const now = new Date();
    const nearDate = addDaysNZ(todayNZ(now), 2);
    const prog = await makeProgramme({ dates: [nearDate], weekday: 'monday' });
    await db.doc(paths.entry(`${prog.sessionIds[0]}_${m}`)).set(
      seedConfirmedEntry(prog.sessionIds[0]!, m, nearDate, prog.seriesId),
    );

    await runSendSessionReminders(now);
    expect(await notificationsFor(m, 'session_reminder')).toHaveLength(0);
  });
});

describe('runSendDailyDigest', () => {
  it('bundles pending notifications into one email, marks them emailed, and excludes always-immediate types', async () => {
    const m = await makeMember('digest-bundle@example.org');
    await setPrefs(m, { digest: 'daily' });

    const n1 = await createNotification(m, 'claimed', 'First title', 'First body');
    const n2 = await createNotification(m, 'invite_received', 'Second title', 'Second body');
    const n3 = await createNotification(m, 'security', 'Security title', 'Security body');

    const report = await runSendDailyDigest(new Date());
    expect(report.emailsSent).toBe(1);

    const emails = await outboxEmailsFor('digest-bundle@example.org');
    expect(emails).toHaveLength(1);
    const text = emails[0]!.data().text as string;
    expect(text).toContain('First title');
    expect(text).toContain('Second title');
    expect(text).not.toContain('Security title');

    const [reread1, reread2, reread3] = await Promise.all(
      [n1.id, n2.id, n3.id].map(async (id) => (await db.doc(paths.notification(id)).get()).data()!),
    );
    expect(reread1.channelsSent).toContain('email');
    expect(reread2.channelsSent).toContain('email');
    expect(reread3.channelsSent).not.toContain('email');
  });

  it('sends nothing for a daily-digest member with no pending notifications', async () => {
    const m = await makeMember('digest-empty@example.org');
    await setPrefs(m, { digest: 'daily' });

    await runSendDailyDigest(new Date());
    expect(await outboxEmailsFor('digest-empty@example.org')).toHaveLength(0);
  });
});

describe('runPurgeExpired', () => {
  // Every case below uses the real wall clock as `now` (rather than a fixed
  // future/past date): `createNotification` and friends stamp `createdAt`
  // with the real `new Date()` regardless of what `now` a test hands to
  // `runPurgeExpired`, so a fictional `now` far from the real clock made an
  // "expire this" fixture and a same-instant "keep this" fixture (or a
  // notification this very call creates for an expired invite) land on the
  // wrong side of a cutoff computed from that fictional `now`.
  it('deletes expired login codes, stale rate limits, and old notifications; keeps recent notifications', async () => {
    const now = new Date();
    const pastIso = new Date(now.getTime() - 60_000).toISOString();
    const staleRateLimitIso = new Date(now.getTime() - 2 * 24 * 3600 * 1000).toISOString();
    const oldNotificationIso = new Date(now.getTime() - 200 * 24 * 3600 * 1000).toISOString();

    await db.collection('emailCodes').doc('purge-code').set({
      id: 'purge-code',
      codeHmac: 'x',
      expiresAt: pastIso,
      attempts: 0,
      createdAt: pastIso,
    });
    await db.collection('rateLimits').doc('purge-rl').set({
      id: 'purge-rl',
      windowStart: staleRateLimitIso,
      count: 1,
    });

    const oldNotifMember = await makeMember('purge-old-notif@example.org');
    const oldNotif = await createNotification(oldNotifMember, 'claimed', 'Old', 'Old body');
    await db.doc(paths.notification(oldNotif.id)).set({ createdAt: oldNotificationIso }, { merge: true });

    const recentMember = await makeMember('purge-recent-notif@example.org');
    const recentNotif = await createNotification(recentMember, 'claimed', 'Recent', 'Recent body');

    const report = await runPurgeExpired(now);
    expect(report.emailCodesDeleted).toBeGreaterThanOrEqual(1);
    expect(report.rateLimitsDeleted).toBeGreaterThanOrEqual(1);
    expect(report.notificationsDeleted).toBeGreaterThanOrEqual(1);

    expect((await db.collection('emailCodes').doc('purge-code').get()).exists).toBe(false);
    expect((await db.collection('rateLimits').doc('purge-rl').get()).exists).toBe(false);
    expect((await db.doc(paths.notification(oldNotif.id)).get()).exists).toBe(false);
    expect((await db.doc(paths.notification(recentNotif.id)).get()).exists).toBe(true);
  });

  it('expires a pending invite past its expiresAt and notifies the sender', async () => {
    const a = await makeMember('purge-invite-a@example.org');
    const b = await makeMember('purge-invite-b@example.org');
    const now = new Date();
    const nearDate = addDaysNZ(todayNZ(now), 14);
    const prog = await makeProgramme({ dates: [nearDate], weekday: 'monday' });

    const { invite } = await sendInviteHandler(
      fakeCallableRequest<SendInviteInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0]!, toMemberId: b },
        { uid: a },
      ),
    );
    await db.doc(paths.invite(invite.id)).set({ expiresAt: new Date(now.getTime() - 60_000).toISOString() }, { merge: true });

    await runPurgeExpired(now);

    const updated = (await db.doc(paths.invite(invite.id)).get()).data() as Invite;
    expect(updated.status).toBe('expired');
    expect(await notificationsFor(a, 'invite_expired')).toHaveLength(1);
  });

  it('purges a visitor unused 18+ months with no future entries; keeps one with a future entry', async () => {
    const owner = await makeMember('purge-visitor-owner@example.org');
    const now = new Date();
    const staleLastUsedIso = new Date(now.getTime() - 20 * 30 * 24 * 3600 * 1000).toISOString(); // ~20 months ago

    const staleVisitorId = randomUUID();
    await db.doc(paths.visitor(staleVisitorId)).set({
      id: staleVisitorId,
      displayName: 'Stale Visitor',
      createdByMemberId: owner,
      courtesyEmails: false,
      lastUsedAt: staleLastUsedIso,
      createdAt: staleLastUsedIso,
      updatedAt: staleLastUsedIso,
    });

    const busyVisitorId = randomUUID();
    await db.doc(paths.visitor(busyVisitorId)).set({
      id: busyVisitorId,
      displayName: 'Busy Visitor',
      createdByMemberId: owner,
      courtesyEmails: false,
      lastUsedAt: staleLastUsedIso,
      createdAt: staleLastUsedIso,
      updatedAt: staleLastUsedIso,
    });

    const futureDate = addDaysNZ(todayNZ(now), 30);
    const prog = await makeProgramme({ dates: [futureDate], weekday: 'monday' });
    const entryId = `${prog.sessionIds[0]}_${owner}`;
    const entry: Entry = {
      id: entryId,
      sessionId: prog.sessionIds[0]!,
      date: futureDate,
      weekday: 'monday',
      seriesId: prog.seriesId,
      memberId: owner,
      status: 'confirmed',
      partner: { kind: 'visitor', visitorId: busyVisitorId, displayName: 'Busy Visitor' },
      pairingId: randomUUID(),
      teamId: null,
      teamSessionOnly: false,
      substitute: null,
      partnerSubstitute: null,
      isSubstituteFor: null,
      createdBy: owner,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await db.doc(paths.entry(entryId)).set(entry);

    await runPurgeExpired(now);

    expect((await db.doc(paths.visitor(staleVisitorId)).get()).exists).toBe(false);
    expect((await db.doc(paths.visitor(busyVisitorId)).get()).exists).toBe(true);

    const auditSnap = await db.collection(paths.auditLog()).where('action', '==', 'visitor_purged').get();
    expect(auditSnap.docs.some((d) => d.data().entityRef === paths.visitor(staleVisitorId))).toBe(true);
  });
});

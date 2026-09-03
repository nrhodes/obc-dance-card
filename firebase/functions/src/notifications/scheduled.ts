/**
 * Scheduled jobs (plan §9.2 "Scheduled", §16 Phase 5): `sendSessionReminders`
 * (08:00 NZ), `sendDailyDigest` (17:00 NZ), `purgeExpired` (03:30 NZ). Every
 * job's actual logic lives in a plain `runXxx(now?)` async function so tests
 * can call it directly with a fixed clock — Cloud Scheduler does not fire in
 * the Firestore/Auth-only emulator this repo's test suite starts
 * (`npm run test:emu` — see `firebase.json`), and a fixed `now` is required
 * to test the NZ-calendar-day maths deterministically (plan §17, DST cases).
 */
import { FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  addDaysNZ,
  paths,
  todayNZ,
  type Entry,
  type Invite,
  type MemberPrivate,
  type Notification,
  type NotificationType,
  type Session,
  type Visitor,
} from '@obc/shared';
import { db } from '../lib/admin.js';
import { audit } from '../lib/audit.js';
import { BatchWriter } from '../lib/batchWriter.js';
import { logger } from '../lib/logger.js';
import { SMTP_PASS } from '../lib/secrets.js';
import { getEmailProvider } from '../email/provider.js';
import { digestEmail } from '../email/templates/digest.js';
import { createNotification } from './create.js';

const REGION = 'australia-southeast1';
const NZ_TIME_ZONE = 'Pacific/Auckland';

/** Kept in lockstep with `dispatch.ts`'s list — these never wait for a digest. */
const ALWAYS_IMMEDIATE_EMAIL_TYPES: readonly NotificationType[] = ['security', 'broadcast', 'on_behalf_action'];

/* ------------------------------ sendSessionReminders ------------------------- */

/**
 * The reminder body (plan §9.2 row / task brief §C): names the series (falls
 * back to the session's title, e.g. for a Holiday Bridge single) and who the
 * member is playing with, or that they are listed as looking for a partner.
 */
async function reminderContent(entry: Entry): Promise<{ title: string; body: string }> {
  const year = Number(entry.date.slice(0, 4));
  const sessionSnap = await db.doc(paths.session(year, entry.sessionId)).get();
  const session = sessionSnap.data() as Session | undefined;
  const label = session?.seriesName ?? session?.title ?? 'bridge';
  const title = `Reminder: ${entry.date}`;

  if (entry.status === 'looking_for_partner' || entry.status === 'available') {
    return { title, body: `You're listed as looking for a partner on ${entry.date} (${label}).` };
  }
  if (entry.teamId) {
    return { title, body: `You're playing ${label} on ${entry.date} with your team.` };
  }
  if (entry.status === 'substituted' && entry.substitute) {
    return { title, body: `${entry.substitute.displayName} is standing in for you on ${entry.date} (${label}).` };
  }
  if (entry.partner) {
    return { title, body: `You're playing ${label} on ${entry.date} with ${entry.partner.displayName}.` };
  }
  return { title, body: `You're playing ${label} on ${entry.date}.` };
}

export interface ReminderReport {
  sent: number;
}

export async function runSendSessionReminders(now: Date = new Date()): Promise<ReminderReport> {
  let sent = 0;
  const membersSnap = await db.collection(paths.members()).where('active', '==', true).get();

  for (const memberDoc of membersSnap.docs) {
    const memberId = memberDoc.id;
    const privateSnap = await db.doc(paths.memberPrivate(memberId)).get();
    const mp = privateSnap.data() as MemberPrivate | undefined;
    if (!mp?.notificationPrefs.reminders) continue;

    const targetDate = addDaysNZ(todayNZ(now), mp.notificationPrefs.reminderDaysBefore);
    const entriesSnap = await db
      .collection(paths.entries())
      .where('memberId', '==', memberId)
      .where('date', '==', targetDate)
      .get();
    if (entriesSnap.empty) continue;

    // One query per member (not per entry) for existing reminders — an
    // equality-only compound query (`memberId`, `type`), so no composite
    // index is required; `data.entryId` is matched in code.
    const existingSnap = await db
      .collection(paths.notifications())
      .where('memberId', '==', memberId)
      .where('type', '==', 'session_reminder')
      .get();
    const alreadyReminded = new Set(existingSnap.docs.map((d) => (d.data() as Notification).data.entryId));

    for (const entryDoc of entriesSnap.docs) {
      const entry = entryDoc.data() as Entry;
      // `unavailable` (plan §21 B2) is "don't ask me for this session" — not a
      // booking, so it gets no reminder either, exactly like `cancelled`.
      if (entry.status === 'cancelled' || entry.status === 'unavailable') continue;
      if (alreadyReminded.has(entry.id)) continue;

      const { title, body } = await reminderContent(entry);
      await createNotification(memberId, 'session_reminder', title, body, {
        entryId: entry.id,
        sessionId: entry.sessionId,
      });
      sent += 1;
    }
  }

  logger.info('send_session_reminders_done', { sent });
  return { sent };
}

export const sendSessionReminders = onSchedule(
  { schedule: '0 8 * * *', timeZone: NZ_TIME_ZONE, region: REGION, secrets: [SMTP_PASS] },
  async () => {
    await runSendSessionReminders();
  },
);

/* -------------------------------- sendDailyDigest ----------------------------- */

export interface DigestReport {
  emailsSent: number;
}

export async function runSendDailyDigest(now: Date = new Date()): Promise<DigestReport> {
  let emailsSent = 0;
  const cutoffIso = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

  const membersSnap = await db.collection(paths.members()).where('active', '==', true).get();
  for (const memberDoc of membersSnap.docs) {
    const memberId = memberDoc.id;
    const privateSnap = await db.doc(paths.memberPrivate(memberId)).get();
    const mp = privateSnap.data() as MemberPrivate | undefined;
    if (!mp || !mp.notificationPrefs.email || mp.notificationPrefs.digest !== 'daily') continue;

    const notifSnap = await db
      .collection(paths.notifications())
      .where('memberId', '==', memberId)
      .where('createdAt', '>=', cutoffIso)
      .get();

    const pending = notifSnap.docs
      .map((d) => d.data() as Notification)
      .filter((n) => !n.channelsSent.includes('email') && !ALWAYS_IMMEDIATE_EMAIL_TYPES.includes(n.type));
    if (pending.length === 0) continue;

    const content = digestEmail(pending.map((n) => ({ title: n.title, body: n.body })));
    await getEmailProvider().send({ to: mp.emailLower, subject: content.subject, text: content.text, html: content.html });
    emailsSent += 1;

    const writer = new BatchWriter();
    for (const n of pending) {
      writer.update(db.doc(paths.notification(n.id)), {
        channelsSent: FieldValue.arrayUnion('email'),
        updatedAt: new Date().toISOString(),
      });
    }
    await writer.flush();
  }

  logger.info('send_daily_digest_done', { emailsSent });
  return { emailsSent };
}

export const sendDailyDigest = onSchedule(
  { schedule: '0 17 * * *', timeZone: NZ_TIME_ZONE, region: REGION, secrets: [SMTP_PASS] },
  async () => {
    await runSendDailyDigest();
  },
);

/* ---------------------------------- purgeExpired ------------------------------ */

const RATE_LIMIT_MAX_AGE_MS = 24 * 3600 * 1000;
const VISITOR_UNUSED_MONTHS = 18;
const NOTIFICATION_MAX_AGE_DAYS = 180;

/** Every visitorId referenced by a non-cancelled entry dated today or later. */
async function visitorIdsWithFutureEntries(now: Date): Promise<Set<string>> {
  const today = todayNZ(now);
  const snap = await db.collection(paths.entries()).where('date', '>=', today).get();
  const ids = new Set<string>();
  for (const doc of snap.docs) {
    const entry = doc.data() as Entry;
    if (entry.status === 'cancelled') continue;
    for (const ref of [entry.partner, entry.substitute, entry.partnerSubstitute]) {
      if (ref?.kind === 'visitor') ids.add(ref.visitorId);
    }
  }
  return ids;
}

export interface PurgeReport {
  emailCodesDeleted: number;
  rateLimitsDeleted: number;
  invitesExpired: number;
  visitorsPurged: number;
  notificationsDeleted: number;
}

export async function runPurgeExpired(now: Date = new Date()): Promise<PurgeReport> {
  const nowIso = now.toISOString();
  const writer = new BatchWriter();
  const counts: PurgeReport = {
    emailCodesDeleted: 0,
    rateLimitsDeleted: 0,
    invitesExpired: 0,
    visitorsPurged: 0,
    notificationsDeleted: 0,
  };

  // 1. emailCodes past expiry.
  const codesSnap = await db.collection(paths.emailCodes()).where('expiresAt', '<', nowIso).get();
  for (const doc of codesSnap.docs) {
    writer.delete(doc.ref);
    counts.emailCodesDeleted += 1;
  }

  // 2. rateLimits older than 1 day.
  const rateLimitCutoffIso = new Date(now.getTime() - RATE_LIMIT_MAX_AGE_MS).toISOString();
  const rateLimitsSnap = await db.collection(paths.rateLimits()).where('windowStart', '<', rateLimitCutoffIso).get();
  for (const doc of rateLimitsSnap.docs) {
    writer.delete(doc.ref);
    counts.rateLimitsDeleted += 1;
  }

  // 3. pending invites past expiresAt -> expired, notify the sender.
  const invitesSnap = await db
    .collection(paths.invites())
    .where('status', '==', 'pending')
    .where('expiresAt', '<', nowIso)
    .get();
  for (const doc of invitesSnap.docs) {
    const invite = doc.data() as Invite;
    writer.update(doc.ref, { status: 'expired', updatedAt: nowIso });
    counts.invitesExpired += 1;
    await createNotification(
      invite.fromMemberId,
      'invite_expired',
      'Your invite expired',
      'Your partner invite expired without a response.',
      { inviteId: invite.id },
    );
  }

  // 4. visitors unused 18+ months with no future non-cancelled entries -> delete.
  const visitorCutoff = new Date(now);
  visitorCutoff.setUTCMonth(visitorCutoff.getUTCMonth() - VISITOR_UNUSED_MONTHS);
  const busyVisitorIds = await visitorIdsWithFutureEntries(now);
  const visitorsSnap = await db.collection(paths.visitors()).where('lastUsedAt', '<', visitorCutoff.toISOString()).get();
  for (const doc of visitorsSnap.docs) {
    const visitor = doc.data() as Visitor;
    if (busyVisitorIds.has(visitor.id)) continue;
    writer.delete(doc.ref);
    counts.visitorsPurged += 1;
    // No member is "acting" for an automated purge; `'system'` is the
    // sentinel actor id for scheduled-job audit rows (there is no earlier
    // convention in this codebase for a system actor — the nightly pairing
    // sweep this mirrors is Phase 6).
    await audit({
      actorMemberId: 'system',
      action: 'visitor_purged',
      targetMemberId: visitor.createdByMemberId,
      entityRef: paths.visitor(visitor.id),
    });
  }

  // 5. notifications older than 180 days -> delete.
  const notificationCutoffIso = new Date(now.getTime() - NOTIFICATION_MAX_AGE_DAYS * 24 * 3600 * 1000).toISOString();
  const notificationsSnap = await db.collection(paths.notifications()).where('createdAt', '<', notificationCutoffIso).get();
  for (const doc of notificationsSnap.docs) {
    writer.delete(doc.ref);
    counts.notificationsDeleted += 1;
  }

  await writer.flush();
  logger.info('purge_expired_done', { ...counts });
  return counts;
}

export const purgeExpired = onSchedule(
  { schedule: '30 3 * * *', timeZone: NZ_TIME_ZONE, region: REGION },
  async () => {
    await runPurgeExpired();
  },
);

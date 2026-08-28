/**
 * Matchmaking alerts (plan §9.2 `setSoloStatus` "Notify" column, §11, task
 * brief §B). Fired from `setSoloStatus` after a member posts
 * `looking_for_partner` on a non-Individual session: every other active
 * member who has opted in (`notificationPrefs.matchmakingAlerts`) and is free
 * on that session gets one `matchmaking_alert` notification, capped at 200
 * recipients and de-duplicated per (recipient, session) within 24h.
 *
 * Plan wording is "(pairs or teams session)" — deliberately excludes
 * Individual-format sessions, where members already arrange their own weekly
 * partner (plan §2) and a club-wide alert would be noise. `setSoloStatus`
 * passes the session's `format` (`undefined` for a non-series singles/holiday
 * session, treated the same as Pairs) so the caller decides eligibility; this
 * module only handles "who gets told".
 */
import { randomUUID } from 'node:crypto';
import { paths, type Entry, type MemberPrivate, type Notification } from '@obc/shared';
import { db } from '../lib/admin.js';
import { BatchWriter } from '../lib/batchWriter.js';

const MAX_RECIPIENTS = 200;
const DEDUPE_WINDOW_MS = 24 * 3600 * 1000;

export interface SendMatchmakingAlertsInput {
  posterMemberId: string;
  posterName: string;
  sessionId: string;
  /** NZ-local `YYYY-MM-DD`, for the notification body. */
  date: string;
}

/**
 * A member counts as "busy" (not free) on `sessionId` if they have any
 * non-cancelled entry for it — including the poster themselves, who is
 * excluded separately below regardless.
 */
async function busyMemberIds(sessionId: string): Promise<Set<string>> {
  const snap = await db.collection(paths.entries()).where('sessionId', '==', sessionId).get();
  const busy = new Set<string>();
  for (const doc of snap.docs) {
    const entry = doc.data() as Entry;
    if (entry.status !== 'cancelled') busy.add(entry.memberId);
  }
  return busy;
}

/** True if `memberId` already got a `matchmaking_alert` for `sessionId` within the last 24h. */
async function alreadyAlerted(memberId: string, sessionId: string, cutoffIso: string): Promise<boolean> {
  const snap = await db
    .collection(paths.notifications())
    .where('memberId', '==', memberId)
    .where('type', '==', 'matchmaking_alert')
    .where('createdAt', '>=', cutoffIso)
    .get();
  return snap.docs.some((d) => (d.data() as Notification).data.sessionId === sessionId);
}

export async function sendMatchmakingAlerts(input: SendMatchmakingAlertsInput): Promise<void> {
  const { posterMemberId, posterName, sessionId, date } = input;

  const [membersSnap, busy] = await Promise.all([
    db.collection(paths.members()).where('active', '==', true).get(),
    busyMemberIds(sessionId),
  ]);

  const candidateIds = membersSnap.docs.map((d) => d.id).filter((id) => id !== posterMemberId && !busy.has(id));
  if (candidateIds.length === 0) return;

  const privateRefs = candidateIds.map((id) => db.doc(paths.memberPrivate(id)));
  const privateSnaps = await db.getAll(...privateRefs);
  const optedIn = candidateIds.filter((_, i) => {
    const mp = privateSnaps[i]?.data() as MemberPrivate | undefined;
    return mp?.notificationPrefs?.matchmakingAlerts === true;
  });

  const cutoffIso = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
  const recipients: string[] = [];
  for (const id of optedIn) {
    if (recipients.length >= MAX_RECIPIENTS) break;
    if (await alreadyAlerted(id, sessionId, cutoffIso)) continue;
    recipients.push(id);
  }
  if (recipients.length === 0) return;

  // Batch-written directly (plan/task brief §B "batch-create via BatchWriter")
  // rather than through `createNotification` one doc at a time — up to 200
  // writes for one post.
  const writer = new BatchWriter();
  const now = new Date().toISOString();
  for (const memberId of recipients) {
    const notification: Notification = {
      id: randomUUID(),
      memberId,
      type: 'matchmaking_alert',
      title: 'Someone is looking for a partner',
      body: `${posterName} is looking for a partner on ${date}.`,
      data: { sessionId, year: date.slice(0, 4) },
      channelsSent: ['inapp'],
      read: false,
      createdAt: now,
      updatedAt: now,
    };
    writer.set(db.doc(paths.notification(notification.id)), notification);
  }
  await writer.flush();
}

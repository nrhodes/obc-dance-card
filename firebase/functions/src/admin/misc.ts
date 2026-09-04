/**
 * `broadcast` and `listAuditLog` (plan §9.2, §10 note, §16 Phase 6). Both
 * admin-only. `listAuditLog` is the *only* way an admin reads `auditLog` —
 * the rules deny direct client reads of that collection (plan §10) — so it
 * stays deliberately narrow: page by `at desc`, filter by at most one of
 * `actorMemberId` / `action` / `targetMemberId` at a time (matching the three
 * composite indexes added for it).
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  BroadcastInputSchema,
  ListAuditLogInputSchema,
  paths,
  todayNZ,
  type AuditLogEntry,
  type BroadcastInput,
  type BroadcastResult,
  type Entry,
  type ListAuditLogInput,
  type ListAuditLogResult,
  type Member,
} from '@obc/shared';
import { db } from '../lib/admin.js';
import { audit } from '../lib/audit.js';
import { callableOptions } from '../lib/callable.js';
import { requireAdmin } from '../lib/context.js';
import { parseInput } from '../lib/parseInput.js';
import { assertRateLimit } from '../lib/rateLimit.js';
import { createNotification } from '../notifications/create.js';

/* ----------------------------------- broadcast ----------------------------------- */

const BROADCAST_DAILY_LIMIT = 5;
const BROADCAST_WINDOW_SEC = 24 * 3600;
const NOTIFY_CHUNK_SIZE = 50;

export async function broadcastHandler(req: CallableRequest<BroadcastInput>): Promise<BroadcastResult> {
  const input = parseInput(BroadcastInputSchema, req.data);
  const caller = await requireAdmin(req);

  await assertRateLimit('broadcast', caller.uid, BROADCAST_DAILY_LIMIT, BROADCAST_WINDOW_SEC);

  // Review-cohort partition (plan §8.1, decided 2026-09-05): a reviewer must
  // never receive a real club-wide broadcast (they have no context for it,
  // and it would leak that the club is actively communicating with members
  // outside the reviewer's synthetic world) — restrict to cohort 'club'.
  const activeSnap = await db
    .collection(paths.members())
    .where('active', '==', true)
    .where('cohort', '==', 'club')
    .get();
  const activeMembers = activeSnap.docs.map((d) => d.data() as Member);

  let recipientIds: string[];
  if (!input.weekdays || input.weekdays.length === 0) {
    recipientIds = activeMembers.map((m) => m.id);
  } else {
    const weekdaySet = new Set(input.weekdays);
    const today = todayNZ();
    const entriesSnap = await db.collection(paths.entries()).where('date', '>=', today).get();
    const membersWithMatchingSession = new Set<string>();
    for (const doc of entriesSnap.docs) {
      const entry = doc.data() as Entry;
      if (entry.status === 'cancelled') continue;
      if (weekdaySet.has(entry.weekday)) membersWithMatchingSession.add(entry.memberId);
    }
    recipientIds = activeMembers.filter((m) => membersWithMatchingSession.has(m.id)).map((m) => m.id);
  }

  for (let i = 0; i < recipientIds.length; i += NOTIFY_CHUNK_SIZE) {
    const chunk = recipientIds.slice(i, i + NOTIFY_CHUNK_SIZE);
    await Promise.all(chunk.map((memberId) => createNotification(memberId, 'broadcast', input.title, input.body, {})));
  }

  await audit({
    actorMemberId: caller.uid,
    action: 'broadcast_sent',
    detail: { recipients: recipientIds.length, title: input.title },
  });

  return { recipients: recipientIds.length };
}

export const broadcast = onCall(callableOptions, broadcastHandler);

/* --------------------------------- listAuditLog ---------------------------------- */

const DEFAULT_LIMIT = 50;

export async function listAuditLogHandler(req: CallableRequest<ListAuditLogInput>): Promise<ListAuditLogResult> {
  const input = parseInput(ListAuditLogInputSchema, req.data);
  await requireAdmin(req);

  const limit = input.limit ?? DEFAULT_LIMIT;
  const filterCount = [input.actorMemberId, input.action, input.targetMemberId].filter((v) => v !== undefined).length;
  if (filterCount > 1) {
    throw new HttpsError('invalid-argument', 'Filter by only one of actorMemberId, action, or targetMemberId at a time.');
  }

  let query: FirebaseFirestore.Query = db.collection(paths.auditLog());
  if (input.actorMemberId) query = query.where('actorMemberId', '==', input.actorMemberId);
  else if (input.action) query = query.where('action', '==', input.action);
  else if (input.targetMemberId) query = query.where('targetMemberId', '==', input.targetMemberId);

  query = query.orderBy('at', 'desc');
  if (input.before) query = query.where('at', '<', input.before);
  query = query.limit(limit + 1);

  const snap = await query.get();
  const rows = snap.docs.slice(0, limit).map((d) => d.data() as AuditLogEntry);
  const nextBefore = snap.docs.length > limit ? rows[rows.length - 1]!.at : undefined;

  return { entries: rows, nextBefore };
}

export const listAuditLog = onCall(callableOptions, listAuditLogHandler);

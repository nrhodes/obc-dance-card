/**
 * `markNotificationsRead` (plan §9.2). The one callable in this phase that
 * has no on-behalf variant — it only ever touches the caller's own docs, and
 * silently ignores any id that isn't theirs (plan: "own; ignore others
 * silently").
 */
import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { MarkNotificationsReadInputSchema, paths, type MarkNotificationsReadInput, type Notification } from '@obc/shared';
import { db } from '../lib/admin.js';
import { callableOptions } from '../lib/callable.js';
import { requireMember } from '../lib/context.js';
import { parseInput } from '../lib/parseInput.js';

export async function markNotificationsReadHandler(
  req: CallableRequest<MarkNotificationsReadInput>,
): Promise<{ ok: true }> {
  const input = parseInput(MarkNotificationsReadInputSchema, req.data);
  const caller = await requireMember(req);

  const refs = input.ids.map((id) => db.doc(paths.notification(id)));
  const snaps = await db.getAll(...refs);
  const now = new Date().toISOString();

  const batch = db.batch();
  let touched = 0;
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const notification = snap.data() as Notification;
    if (notification.memberId !== caller.uid) continue; // silently ignore others' notifications
    batch.set(snap.ref, { read: true, readAt: now }, { merge: true });
    touched += 1;
  }
  if (touched > 0) {
    await batch.commit();
  }

  return { ok: true };
}

export const markNotificationsRead = onCall(callableOptions, markNotificationsReadHandler);

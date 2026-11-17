/**
 * Mark the signed-in member's own notifications read — written directly to
 * Firestore, not through the `markNotificationsRead` callable.
 *
 * This is the one client write the design permits (plan §2, CLAUDE.md:
 * `notifications/{id}.read/readAt` only), and the rules enforce it: owner
 * only, `read` must be a boolean, `readAt` a short string, nothing else may
 * change. Writing directly matters for feel, not just cost: Firestore applies
 * a local write to every open listener immediately, so the unread dots and
 * the badge clear the instant the member taps, while the callable path paid
 * a Cloud Run cold start (several seconds, most taps — 2026-11-17) before
 * anything on screen moved. The callable stays deployed for older iOS builds.
 */
import { doc, writeBatch } from 'firebase/firestore';
import { paths } from '@obc/shared';
import { db } from '../firebase';

/** Firestore caps a batch at 500 operations; stay well inside it. */
const BATCH_LIMIT = 400;

export async function markNotificationsRead(ids: readonly string[]): Promise<void> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return;
  const readAt = new Date().toISOString();
  for (let i = 0; i < unique.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const id of unique.slice(i, i + BATCH_LIMIT)) {
      batch.set(doc(db, paths.notification(id)), { read: true, readAt }, { merge: true });
    }
    await batch.commit();
  }
}

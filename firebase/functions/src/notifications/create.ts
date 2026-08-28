/**
 * Writes a `notifications/{id}` doc directly (plan §5.8). Fan-out to
 * push/email (plan §11 `notify()` + the `onNotificationCreated` trigger) is
 * Phase 5; for now every notification is in-app only.
 */
import { randomUUID } from 'node:crypto';
import type { Notification, NotificationType } from '@obc/shared';
import { db } from '../lib/admin.js';

export async function createNotification(
  memberId: string,
  type: NotificationType,
  title: string,
  body: string,
  data: Record<string, string> = {},
): Promise<Notification> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const notification: Notification = {
    id,
    memberId,
    type,
    title,
    body,
    data,
    channelsSent: ['inapp'],
    read: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection('notifications').doc(id).set(notification);
  return notification;
}

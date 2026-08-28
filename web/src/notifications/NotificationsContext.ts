/**
 * Shared "my notifications" subscription (plan Phase 3b task, §11): the
 * newest 50 notifications, for both the nav's unread badge and the
 * `/notifications` feed. Mirrors `ProgrammeContext`'s single-subscription
 * split. The unread count is derived from this same page of 50 — a member
 * with more than 50 unread notifications would undercount, which is an
 * acceptable simplification at club scale rather than a second listener.
 */
import { createContext } from 'react';
import type { Notification } from '@obc/shared';

export interface NotificationsContextValue {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
}

export const NotificationsContext = createContext<NotificationsContextValue | undefined>(undefined);

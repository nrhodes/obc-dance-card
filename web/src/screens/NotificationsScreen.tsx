/**
 * Notifications feed (`/notifications`, plan Phase 3b task, deliverable 4,
 * §11). Newest 50 notifications; unread ones are styled distinctly; tapping
 * one marks it read via `markNotificationsRead` and follows its `data` deep
 * link (`sessionId` + `year` → the session page; `inviteId` → Invites).
 * "Mark all read" marks every currently-unread one in the same way.
 */
import { useNavigate } from 'react-router-dom';
import type { Notification } from '@obc/shared';
import { useNotifications } from '../notifications/useNotifications';
import { markNotificationsRead } from '../api';
import { formatDateTimeNZ } from '../lib/format';
import { SubscriptionError } from '../components/SubscriptionError';

function deepLinkFor(notification: Notification): string | null {
  const { sessionId, year, inviteId } = notification.data;
  if (sessionId && year) return `/session/${year}/${sessionId}`;
  if (inviteId) return '/invites';
  return null;
}

export function NotificationsScreen() {
  const { notifications, unreadCount, loading, error } = useNotifications();
  const navigate = useNavigate();

  async function handleOpen(notification: Notification) {
    if (!notification.read) {
      await markNotificationsRead({ ids: [notification.id] }).catch(() => undefined);
    }
    const link = deepLinkFor(notification);
    if (link) navigate(link);
  }

  async function handleMarkAllRead() {
    const ids = notifications.filter((n) => !n.read).map((n) => n.id);
    if (ids.length === 0) return;
    await markNotificationsRead({ ids }).catch(() => undefined);
  }

  return (
    <div className="stack">
      <div className="card">
        <h1>Notifications</h1>
        <button type="button" className="button button-secondary" disabled={unreadCount === 0} onClick={() => void handleMarkAllRead()}>
          Mark all read
        </button>
      </div>

      <div className="card">
        {error && <SubscriptionError resource="notifications" />}
        {loading && <p>Loading…</p>}
        {!loading && notifications.length === 0 && <p className="muted">Nothing here yet.</p>}
        {!loading &&
          notifications.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`notification-item${n.read ? '' : ' notification-item-unread'}`}
              onClick={() => void handleOpen(n)}
            >
              <strong>{n.title}</strong>
              <p>{n.body}</p>
              <p className="muted">{formatDateTimeNZ(n.createdAt)}</p>
            </button>
          ))}
      </div>
    </div>
  );
}

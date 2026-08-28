import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { paths, type Notification } from '@obc/shared';
import { db } from '../firebase';
import { useAuth } from '../auth/useAuth';
import { NotificationsContext, type NotificationsContextValue } from './NotificationsContext';

const FEED_LIMIT = 50;

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { member } = useAuth();
  const uid = member?.id ?? null;

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setNotifications([]);
      setLoading(true);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, paths.notifications()),
      where('memberId', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(FEED_LIMIT),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setNotifications(snap.docs.map((d) => d.data() as Notification));
        setLoading(false);
      },
      () => {
        setNotifications([]);
        setLoading(false);
      },
    );
    return unsub;
  }, [uid]);

  const value = useMemo<NotificationsContextValue>(
    () => ({ notifications, unreadCount: notifications.filter((n) => !n.read).length, loading }),
    [notifications, loading],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { paths, type Invite } from '@obc/shared';
import { db } from '../firebase';
import { useAuth } from '../auth/useAuth';
import { InvitesContext, type InvitesContextValue } from './InvitesContext';

const RESOLVED_STATUSES = ['accepted', 'declined', 'expired', 'cancelled'] as const;
const RESOLVED_LIMIT = 10;

export function InvitesProvider({ children }: { children: ReactNode }) {
  const { member } = useAuth();
  const uid = member?.id ?? null;

  const [incoming, setIncoming] = useState<Invite[]>([]);
  const [outgoing, setOutgoing] = useState<Invite[]>([]);
  const [resolvedToMe, setResolvedToMe] = useState<Invite[]>([]);
  const [resolvedFromMe, setResolvedFromMe] = useState<Invite[]>([]);
  const [loaded, setLoaded] = useState({ incoming: false, outgoing: false, resolvedToMe: false, resolvedFromMe: false });

  useEffect(() => {
    if (!uid) {
      setIncoming([]);
      setOutgoing([]);
      setResolvedToMe([]);
      setResolvedFromMe([]);
      setLoaded({ incoming: true, outgoing: true, resolvedToMe: true, resolvedFromMe: true });
      return;
    }

    const invites = collection(db, paths.invites());

    const unsubIncoming = onSnapshot(
      query(invites, where('toMemberId', '==', uid), where('status', '==', 'pending'), orderBy('createdAt', 'desc')),
      (snap) => {
        setIncoming(snap.docs.map((d) => d.data() as Invite));
        setLoaded((l) => ({ ...l, incoming: true }));
      },
      () => setLoaded((l) => ({ ...l, incoming: true })),
    );

    const unsubOutgoing = onSnapshot(
      query(invites, where('fromMemberId', '==', uid), where('status', '==', 'pending'), orderBy('createdAt', 'desc')),
      (snap) => {
        setOutgoing(snap.docs.map((d) => d.data() as Invite));
        setLoaded((l) => ({ ...l, outgoing: true }));
      },
      () => setLoaded((l) => ({ ...l, outgoing: true })),
    );

    const unsubResolvedToMe = onSnapshot(
      query(
        invites,
        where('toMemberId', '==', uid),
        where('status', 'in', [...RESOLVED_STATUSES]),
        orderBy('createdAt', 'desc'),
        limit(RESOLVED_LIMIT),
      ),
      (snap) => {
        setResolvedToMe(snap.docs.map((d) => d.data() as Invite));
        setLoaded((l) => ({ ...l, resolvedToMe: true }));
      },
      () => setLoaded((l) => ({ ...l, resolvedToMe: true })),
    );

    const unsubResolvedFromMe = onSnapshot(
      query(
        invites,
        where('fromMemberId', '==', uid),
        where('status', 'in', [...RESOLVED_STATUSES]),
        orderBy('createdAt', 'desc'),
        limit(RESOLVED_LIMIT),
      ),
      (snap) => {
        setResolvedFromMe(snap.docs.map((d) => d.data() as Invite));
        setLoaded((l) => ({ ...l, resolvedFromMe: true }));
      },
      () => setLoaded((l) => ({ ...l, resolvedFromMe: true })),
    );

    return () => {
      unsubIncoming();
      unsubOutgoing();
      unsubResolvedToMe();
      unsubResolvedFromMe();
    };
  }, [uid]);

  const resolved = useMemo(
    () =>
      [...resolvedToMe, ...resolvedFromMe]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, RESOLVED_LIMIT),
    [resolvedToMe, resolvedFromMe],
  );

  const value = useMemo<InvitesContextValue>(
    () => ({
      incoming,
      outgoing,
      resolved,
      loading: !loaded.incoming || !loaded.outgoing || !loaded.resolvedToMe || !loaded.resolvedFromMe,
    }),
    [incoming, outgoing, resolved, loaded],
  );

  return <InvitesContext.Provider value={value}>{children}</InvitesContext.Provider>;
}

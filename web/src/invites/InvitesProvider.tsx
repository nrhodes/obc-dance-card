import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { paths, type Invite } from '@obc/shared';
import { db } from '../firebase';
import { useEffectiveMember } from '../admin/useEffectiveMember';
import { InvitesContext, type InvitesContextValue } from './InvitesContext';

const RESOLVED_STATUSES = ['accepted', 'declined', 'expired', 'cancelled'] as const;
const RESOLVED_LIMIT = 10;

export function InvitesProvider({ children }: { children: ReactNode }) {
  // Plan Phase 6b task deliverable 2: while an admin is acting on behalf of a
  // member, this screen's "my invites" reads that member's invites instead
  // of the admin's own.
  const { effectiveMemberId: uid } = useEffectiveMember();

  const [incoming, setIncoming] = useState<Invite[]>([]);
  const [outgoing, setOutgoing] = useState<Invite[]>([]);
  const [resolvedToMe, setResolvedToMe] = useState<Invite[]>([]);
  const [resolvedFromMe, setResolvedFromMe] = useState<Invite[]>([]);
  const [loaded, setLoaded] = useState({ incoming: false, outgoing: false, resolvedToMe: false, resolvedFromMe: false });
  const [error, setError] = useState<{ code: string } | null>(null);

  useEffect(() => {
    if (!uid) {
      setIncoming([]);
      setOutgoing([]);
      setResolvedToMe([]);
      setResolvedFromMe([]);
      setLoaded({ incoming: true, outgoing: true, resolvedToMe: true, resolvedFromMe: true });
      setError(null);
      return;
    }
    setError(null);

    const invites = collection(db, paths.invites());
    const onError = (name: string, key: keyof typeof loaded) => (err: { code: string }) => {
      console.error('subscription_failed', name, err.code);
      setError({ code: err.code });
      setLoaded((l) => ({ ...l, [key]: true }));
    };

    const unsubIncoming = onSnapshot(
      query(invites, where('toMemberId', '==', uid), where('status', '==', 'pending'), orderBy('createdAt', 'desc')),
      (snap) => {
        setIncoming(snap.docs.map((d) => d.data() as Invite));
        setLoaded((l) => ({ ...l, incoming: true }));
      },
      onError('invites_incoming', 'incoming'),
    );

    const unsubOutgoing = onSnapshot(
      query(invites, where('fromMemberId', '==', uid), where('status', '==', 'pending'), orderBy('createdAt', 'desc')),
      (snap) => {
        setOutgoing(snap.docs.map((d) => d.data() as Invite));
        setLoaded((l) => ({ ...l, outgoing: true }));
      },
      onError('invites_outgoing', 'outgoing'),
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
      onError('invites_resolved_to_me', 'resolvedToMe'),
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
      onError('invites_resolved_from_me', 'resolvedFromMe'),
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
      error,
    }),
    [incoming, outgoing, resolved, loaded, error],
  );

  return <InvitesContext.Provider value={value}>{children}</InvitesContext.Provider>;
}

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { paths, type Visitor } from '@obc/shared';
import { db } from '../firebase';
import { useEffectiveMember } from '../admin/useEffectiveMember';
import { VisitorsContext, type VisitorsContextValue } from './VisitorsContext';

export function VisitorsProvider({ children }: { children: ReactNode }) {
  // Plan Phase 6b task deliverable 2: while an admin is acting on behalf of a
  // member, "my visitors" reads that member's visitors — an admin may read
  // any visitor doc (rules §10), so this query is unaffected either way.
  const { effectiveMemberId: uid } = useEffectiveMember();

  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code: string } | null>(null);

  useEffect(() => {
    if (!uid) {
      setVisitors([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    const q = query(collection(db, paths.visitors()), where('createdByMemberId', '==', uid), orderBy('lastUsedAt', 'desc'));
    return onSnapshot(
      q,
      (snap) => {
        setVisitors(snap.docs.map((d) => d.data() as Visitor));
        setError(null);
        setLoading(false);
      },
      (err) => {
        console.error('subscription_failed', 'visitors', err.code);
        setVisitors([]);
        setError({ code: err.code });
        setLoading(false);
      },
    );
  }, [uid]);

  const value = useMemo<VisitorsContextValue>(() => ({ visitors, loading, error }), [visitors, loading, error]);

  return <VisitorsContext.Provider value={value}>{children}</VisitorsContext.Provider>;
}

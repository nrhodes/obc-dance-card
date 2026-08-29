import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { paths, type Visitor } from '@obc/shared';
import { db } from '../firebase';
import { useAuth } from '../auth/useAuth';
import { VisitorsContext, type VisitorsContextValue } from './VisitorsContext';

export function VisitorsProvider({ children }: { children: ReactNode }) {
  const { member } = useAuth();
  const uid = member?.id ?? null;

  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setVisitors([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(collection(db, paths.visitors()), where('createdByMemberId', '==', uid), orderBy('lastUsedAt', 'desc'));
    return onSnapshot(
      q,
      (snap) => {
        setVisitors(snap.docs.map((d) => d.data() as Visitor));
        setLoading(false);
      },
      () => {
        setVisitors([]);
        setLoading(false);
      },
    );
  }, [uid]);

  const value = useMemo<VisitorsContextValue>(() => ({ visitors, loading }), [visitors, loading]);

  return <VisitorsContext.Provider value={value}>{children}</VisitorsContext.Provider>;
}

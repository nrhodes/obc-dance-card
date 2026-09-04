import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { paths, type Member } from '@obc/shared';
import { db } from '../firebase';
import { useAuth } from '../auth/useAuth';
import { MembersDirectoryContext, type MembersDirectoryContextValue } from './MembersDirectoryContext';

export function MembersDirectoryProvider({ children }: { children: ReactNode }) {
  // App-Store-review cohort partition (plan §8.1, decided 2026-09-05): the
  // `members` rule requires `resource.data.cohort == callerCohort()` for a
  // non-admin, non-self read, so this query must filter on cohort — and it
  // must WAIT for the caller's own member doc (already subscribed by
  // `AuthProvider`, which sits above this provider — plan App.tsx) before
  // subscribing, rather than fire once with an undefined cohort.
  const { member } = useAuth();
  const ownCohort = member?.cohort;

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code: string } | null>(null);

  useEffect(() => {
    if (!ownCohort) {
      setMembers([]);
      setLoading(true);
      return;
    }
    const q = query(
      collection(db, paths.members()),
      where('active', '==', true),
      where('cohort', '==', ownCohort),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setMembers(snap.docs.map((d) => d.data() as Member));
        setError(null);
        setLoading(false);
      },
      (err) => {
        console.error('subscription_failed', 'members', err.code);
        setMembers([]);
        setError({ code: err.code });
        setLoading(false);
      },
    );
    return unsub;
  }, [ownCohort]);

  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const nameOf = useCallback(
    (memberId: string) => {
      const m = byId.get(memberId);
      return m ? `${m.firstName} ${m.lastName}` : 'A member';
    },
    [byId],
  );

  const value = useMemo<MembersDirectoryContextValue>(
    () => ({ members, byId, nameOf, loading, error }),
    [members, byId, nameOf, loading, error],
  );

  return <MembersDirectoryContext.Provider value={value}>{children}</MembersDirectoryContext.Provider>;
}

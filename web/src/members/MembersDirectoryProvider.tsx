import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { paths, type Member } from '@obc/shared';
import { db } from '../firebase';
import { MembersDirectoryContext, type MembersDirectoryContextValue } from './MembersDirectoryContext';

export function MembersDirectoryProvider({ children }: { children: ReactNode }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, paths.members()), where('active', '==', true));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setMembers(snap.docs.map((d) => d.data() as Member));
        setLoading(false);
      },
      () => {
        setMembers([]);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const nameOf = useCallback(
    (memberId: string) => {
      const m = byId.get(memberId);
      return m ? `${m.firstName} ${m.lastName}` : 'A member';
    },
    [byId],
  );

  const value = useMemo<MembersDirectoryContextValue>(
    () => ({ members, byId, nameOf, loading }),
    [members, byId, nameOf, loading],
  );

  return <MembersDirectoryContext.Provider value={value}>{children}</MembersDirectoryContext.Provider>;
}

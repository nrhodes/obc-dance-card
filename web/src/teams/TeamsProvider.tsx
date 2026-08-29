import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { paths, type Team } from '@obc/shared';
import { db } from '../firebase';
import { useAuth } from '../auth/useAuth';
import { TeamsContext, type TeamsContextValue } from './TeamsContext';

export function TeamsProvider({ children }: { children: ReactNode }) {
  const { member } = useAuth();
  const selfId = member?.id ?? null;

  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, paths.teams()), where('status', 'in', ['forming', 'active']));
    return onSnapshot(
      q,
      (snap) => {
        setTeams(snap.docs.map((d) => d.data() as Team));
        setLoading(false);
      },
      () => {
        setTeams([]);
        setLoading(false);
      },
    );
  }, []);

  const teamsForSeries = useCallback((seriesId: string) => teams.filter((t) => t.seriesId === seriesId), [teams]);

  const myTeamForSeries = useCallback(
    (seriesId: string): Team | null => {
      if (!selfId) return null;
      return (
        teams.find(
          (t) => t.seriesId === seriesId && t.members.some((m) => m.ref.kind === 'member' && m.ref.memberId === selfId),
        ) ?? null
      );
    },
    [teams, selfId],
  );

  const teamById = useCallback((teamId: string) => teams.find((t) => t.id === teamId), [teams]);

  const value = useMemo<TeamsContextValue>(
    () => ({ teams, loading, teamsForSeries, myTeamForSeries, teamById }),
    [teams, loading, teamsForSeries, myTeamForSeries, teamById],
  );

  return <TeamsContext.Provider value={value}>{children}</TeamsContext.Provider>;
}

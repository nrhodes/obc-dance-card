import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { paths, type Team } from '@obc/shared';
import { db } from '../firebase';
import { useEffectiveMember } from '../admin/useEffectiveMember';
import { TeamsContext, type TeamsContextValue } from './TeamsContext';

export function TeamsProvider({ children }: { children: ReactNode }) {
  // Plan Phase 6b task deliverable 2: `myTeamForSeries` reads as the acted-on
  // member while an admin is acting on their behalf.
  const { effectiveMemberId: selfId } = useEffectiveMember();

  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code: string } | null>(null);

  useEffect(() => {
    const q = query(collection(db, paths.teams()), where('status', 'in', ['forming', 'active']));
    return onSnapshot(
      q,
      (snap) => {
        setTeams(snap.docs.map((d) => d.data() as Team));
        setError(null);
        setLoading(false);
      },
      (err) => {
        console.error('subscription_failed', 'teams', err.code);
        setTeams([]);
        setError({ code: err.code });
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
    () => ({ teams, loading, teamsForSeries, myTeamForSeries, teamById, error }),
    [teams, loading, teamsForSeries, myTeamForSeries, teamById, error],
  );

  return <TeamsContext.Provider value={value}>{children}</TeamsContext.Provider>;
}

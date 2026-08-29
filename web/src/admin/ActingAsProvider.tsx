import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/useAuth';
import { ActingAsContext, type ActingAsContextValue, type ActingAsTarget } from './ActingAsContext';

/**
 * Mounted once, inside the member-only part of the route tree (plan Phase 6b
 * task deliverable 2). Holds the acted-on member id/name only in memory —
 * there is nothing to persist across a reload; a reload simply returns the
 * admin to acting as themselves, which is the safer default.
 */
export function ActingAsProvider({ children }: { children: ReactNode }) {
  const { member } = useAuth();
  const isAdmin = member?.role === 'admin';
  const [actingAs, setActingAs] = useState<ActingAsTarget | null>(null);

  // Acting-as is meaningless (and server-rejected) for a non-admin, and must
  // never survive a sign-out/sign-in as someone else.
  useEffect(() => {
    if (!isAdmin) setActingAs(null);
  }, [isAdmin]);
  useEffect(() => {
    if (!member) setActingAs(null);
  }, [member]);

  const value = useMemo<ActingAsContextValue>(
    () => ({
      actingAs,
      startActingAs: (target: ActingAsTarget) => {
        if (isAdmin) setActingAs(target);
      },
      stopActingAs: () => setActingAs(null),
    }),
    [actingAs, isAdmin],
  );

  return <ActingAsContext.Provider value={value}>{children}</ActingAsContext.Provider>;
}

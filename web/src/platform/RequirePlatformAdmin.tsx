import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { usePlatformAdmin } from './usePlatformAdmin';

/** Platform-admin-only route. Cosmetic: the server checks every platform callable (plan §21 B14.3). */
export function RequirePlatformAdmin({ children }: { children: ReactNode }) {
  const { isPlatformAdmin, loading } = usePlatformAdmin();
  if (loading) return <p>Loading…</p>;
  if (!isPlatformAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

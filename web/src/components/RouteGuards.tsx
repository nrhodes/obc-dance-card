import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { NotActiveScreen } from '../screens/NotActiveScreen';

/** Wraps every member-facing route: unauthenticated -> /signin, deactivated -> the not-active screen. */
export function RequireMember({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === 'loading') {
    return <LoadingScreen />;
  }
  if (status === 'signedOut') {
    return <Navigate to="/signin" replace />;
  }
  if (status === 'notActive') {
    return <NotActiveScreen />;
  }
  return <>{children}</>;
}

/** Wraps /signin: bounce an already-signed-in member to the home screen. */
export function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === 'loading') {
    return <LoadingScreen />;
  }
  if (status === 'signedIn') {
    return <Navigate to="/" replace />;
  }
  if (status === 'notActive') {
    return <NotActiveScreen />;
  }
  return <>{children}</>;
}

/** Admin-only routes. Server-side checks are the real guard (plan §14.1); this is cosmetic. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { status, member } = useAuth();

  if (status === 'loading') {
    return <LoadingScreen />;
  }
  if (status === 'signedOut') {
    return <Navigate to="/signin" replace />;
  }
  if (status === 'notActive') {
    return <NotActiveScreen />;
  }
  if (member?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function LoadingScreen() {
  return (
    <main id="content">
      <p>Loading…</p>
    </main>
  );
}

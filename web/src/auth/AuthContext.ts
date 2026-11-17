/**
 * The auth context definition, split out from `AuthProvider.tsx` so that
 * file can export only the `AuthProvider` component (react-refresh works
 * reliably only when a module exports components alone) — see `useAuth.ts`
 * for the consuming hook.
 */
import { createContext } from 'react';
import type { User } from 'firebase/auth';
import type { Member, MemberPrivate } from '@obc/shared';

/**
 * `unavailable`: signed in, but the member record could not be loaded for a
 * reason other than "not an active member" — see `memberDocError.ts`.
 */
export type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'notActive' | 'unavailable';

export interface AuthContextValue {
  status: AuthStatus;
  /** Set only when `status === 'unavailable'`: why the member record could not be loaded. */
  problem: 'browser-not-verified' | 'unavailable' | 'blocked' | null;
  user: User | null;
  member: Member | null;
  memberPrivate: MemberPrivate | null;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

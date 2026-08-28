/**
 * The auth context definition, split out from `AuthProvider.tsx` so that
 * file can export only the `AuthProvider` component (react-refresh works
 * reliably only when a module exports components alone) — see `useAuth.ts`
 * for the consuming hook.
 */
import { createContext } from 'react';
import type { User } from 'firebase/auth';
import type { Member, MemberPrivate } from '@obc/shared';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'notActive';

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  member: Member | null;
  memberPrivate: MemberPrivate | null;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

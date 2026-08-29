/**
 * "Act on behalf of a member" state (plan §2 Act-on-behalf, §8.1 "Cards →
 * IDOR", Phase 6b task deliverable 2). Admin-only, and cosmetic-only on the
 * client: every callable this app calls still re-derives the caller from
 * `req.auth.uid` and independently requires `caller.isAdmin` before it will
 * honour a supplied `onBehalfOfMemberId` (`resolveActingMember`,
 * `firebase/functions/src/lib/context.ts`) — a non-admin who somehow set
 * this context would simply have every on-behalf call rejected server-side.
 *
 * While set, the member-facing screens that read "my" data (My card,
 * Invites, visitors, teams) read the *acted-on* member's data instead of the
 * signed-in admin's, and every mutation those screens make carries
 * `onBehalfOfMemberId` — see `useEffectiveMember` for the derived read/write
 * identity every such provider/screen consumes.
 */
import { createContext } from 'react';

export interface ActingAsTarget {
  memberId: string;
  name: string;
}

export interface ActingAsContextValue {
  actingAs: ActingAsTarget | null;
  /** Admin-only: starting acting-as while not an admin is a silent no-op. */
  startActingAs: (target: ActingAsTarget) => void;
  stopActingAs: () => void;
}

export const ActingAsContext = createContext<ActingAsContextValue | undefined>(undefined);

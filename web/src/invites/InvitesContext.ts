/**
 * Shared "my invites" subscription (plan Phase 3b task): incoming pending
 * invites (for the nav badge and the Invites screen), outgoing pending
 * invites, and the last 10 resolved invites in either direction. Mounted
 * once inside the member-only route tree so the nav badge and `/invites`
 * screen share one set of listeners — mirrors `ProgrammeContext`'s split.
 */
import { createContext } from 'react';
import type { Invite } from '@obc/shared';

export interface InvitesContextValue {
  incoming: Invite[];
  outgoing: Invite[];
  /** Last 10 resolved (accepted/declined/expired/cancelled) invites in either direction, newest first. */
  resolved: Invite[];
  loading: boolean;
  /** Set when a live subscription failed (e.g. a rules denial) — never conflated with "no invites". */
  error: { code: string } | null;
}

export const InvitesContext = createContext<InvitesContextValue | undefined>(undefined);

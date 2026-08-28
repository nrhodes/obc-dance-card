/**
 * Read-only directory of active members' public names, used to resolve a
 * `memberId` (partner steward, noticeboard entries, team captains, …) to a
 * display name without every screen writing its own `members/{id}` lookup.
 * Never touches `memberPrivate` or `visitors` (plan Phase 2b task).
 */
import { createContext } from 'react';
import type { Member } from '@obc/shared';

export interface MembersDirectoryContextValue {
  members: Member[];
  byId: Map<string, Member>;
  /** Full name for an active member id, or a display-safe fallback if unknown. */
  nameOf: (memberId: string) => string;
  loading: boolean;
}

export const MembersDirectoryContext = createContext<MembersDirectoryContextValue | undefined>(undefined);

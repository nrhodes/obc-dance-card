/**
 * Shared "my visitors" subscription (plan Phase 4c task, §5.3, §12): every
 * visitor the signed-in member has created, newest-used first — reused by
 * Profile's "My visitors" screen, the "Play with a visitor" dialog, the
 * substitute dialog's visitor option, and a team captain's "Add a visitor" /
 * session-substitute dialogs. Mirrors `MembersDirectoryContext`'s split.
 */
import { createContext } from 'react';
import type { Visitor } from '@obc/shared';

export interface VisitorsContextValue {
  visitors: Visitor[];
  loading: boolean;
}

export const VisitorsContext = createContext<VisitorsContextValue | undefined>(undefined);

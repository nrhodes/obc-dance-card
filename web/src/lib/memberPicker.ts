/**
 * Pure filter/sort for the "invite a partner" member picker (plan Phase 3b
 * task): search the members directory by name, excluding the signed-in
 * member and anyone already confirmed on this session.
 */
import type { Member } from '@obc/shared';

export interface FilterPickableMembersOptions {
  selfId: string;
  /** memberIds already confirmed on this session (derived from the roster). */
  excludeMemberIds: Iterable<string>;
  query: string;
}

export function filterPickableMembers(members: Member[], opts: FilterPickableMembersOptions): Member[] {
  const exclude = new Set(opts.excludeMemberIds);
  const q = opts.query.trim().toLowerCase();
  return members
    .filter((m) => m.id !== opts.selfId && !exclude.has(m.id))
    .filter((m) => !q || `${m.firstName} ${m.lastName}`.toLowerCase().includes(q))
    .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
}

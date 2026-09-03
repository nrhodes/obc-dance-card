/**
 * The signed-in member's pending invite (if any) for one session. `useInvites`
 * already scopes `incoming`/`outgoing` to the current user and to pending
 * status, so this just narrows to the session. Kept pure for unit testing.
 */
import type { Invite } from '@obc/shared';

export function findPendingInvite(invites: Invite[], sessionId: string): Invite | null {
  return invites.find((i) => i.status === 'pending' && i.sessionIds.includes(sessionId)) ?? null;
}

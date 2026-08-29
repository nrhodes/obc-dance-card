/**
 * Derives the "who am I acting as" identity every member-facing
 * provider/screen reads and writes as (plan Phase 6b task deliverable 2):
 * the acted-on member while an admin is acting on their behalf, otherwise
 * the signed-in member. `onBehalfOfMemberId` is the exact value every
 * callable payload should spread in — `undefined` (omit the key entirely;
 * plan §3 Phase 3b rule) when not acting on behalf of anyone.
 */
import { useAuth } from '../auth/useAuth';
import { useActingAs } from './useActingAs';

export interface EffectiveMember {
  /** The id every subscription should read as; null only while signed out. */
  effectiveMemberId: string | null;
  /** Spread into a callable payload; omit the key when undefined (never pass `onBehalfOfMemberId: undefined`). */
  onBehalfOfMemberId: string | undefined;
  /** Display name of the acted-on member, when acting on behalf of someone else. */
  actingAsName: string | null;
}

export function useEffectiveMember(): EffectiveMember {
  const { member } = useAuth();
  const { actingAs } = useActingAs();
  return {
    effectiveMemberId: actingAs?.memberId ?? member?.id ?? null,
    onBehalfOfMemberId: actingAs?.memberId,
    actingAsName: actingAs?.name ?? null,
  };
}

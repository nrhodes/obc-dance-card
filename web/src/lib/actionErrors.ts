/**
 * Shared callable-error → display copy mapping for every card-core action
 * (plan Phase 3b task: session actions, invites accept/decline/withdraw).
 * `failed-precondition` messages are written server-side to be display-safe
 * (they list conflicting dates etc.) and are shown verbatim; everything else
 * gets a fixed, generic mapping. Kept separate from `sessionActions.ts` so
 * both `SessionScreen` and `InvitesScreen` can share it without an
 * unnecessary cross-import.
 */
import type { AppError } from '../firebase';

const TOO_MANY_INVITES = 'Too many invites today';
const NOT_ALLOWED = "You can't do that.";
const GENERIC = 'Something went wrong. Please try again.';

export function mapActionError(err: AppError): string {
  switch (err.code) {
    case 'failed-precondition':
      return err.message;
    case 'resource-exhausted':
      return TOO_MANY_INVITES;
    case 'permission-denied':
      return NOT_ALLOWED;
    default:
      return GENERIC;
  }
}

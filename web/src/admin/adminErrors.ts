/**
 * Callable-error -> display copy mapping for admin screens (plan §9.2
 * catalogue, Phase 6b task). Unlike `lib/actionErrors.ts` (member-facing),
 * admin `invalid-argument` messages are also safe to show verbatim here:
 * every admin-only callable that can throw `invalid-argument` for a
 * *reason a human needs to read* writes a display-safe message for it —
 * `eraseMember`'s "confirmName does not match…" being the main example —
 * never an echo of raw request data (plan §8.3: "the zod issue path only,
 * no echo of values" governs the zod-parse failures, which are a different,
 * rarer case: a genuinely malformed request from this same UI, which would
 * indicate a bug here rather than something to show a human).
 */
import type { AppError } from '../firebase';

const NOT_ALLOWED = "You can't do that.";
const TOO_MANY = 'Too many requests right now. Please wait and try again.';
const GENERIC = 'Something went wrong. Please try again.';

export function mapAdminActionError(err: AppError): string {
  switch (err.code) {
    case 'failed-precondition':
    case 'invalid-argument':
    case 'not-found':
      return err.message;
    case 'resource-exhausted':
      return TOO_MANY;
    case 'permission-denied':
      return NOT_ALLOWED;
    default:
      return GENERIC;
  }
}

/**
 * Shared inline notice for a failed `onSnapshot` subscription (plan §8.1 /
 * Phase 6b task: "a rules denial on a query was silently rendering an empty
 * inbox until this week"). Every provider that owns a live Firestore
 * subscription now exposes `{ code }` on error instead of quietly falling
 * back to an empty list; screens render this component instead of (or above)
 * whatever empty-state copy they would otherwise show, so a permission
 * failure never looks identical to "there's nothing here".
 *
 * Deliberately generic — the resource name is the only per-screen detail,
 * and the underlying `code` is never shown to the member (it's logged via
 * `console.error('subscription_failed', name, code)` in the provider, never
 * rendered — plan §3/§8.1: never log or display raw error internals beyond
 * an id/code to engineers, and never confuse a club member with a Firestore
 * error code).
 */
export interface SubscriptionErrorProps {
  /** Plural, lower-case noun for what failed to load, e.g. "invites", "the programme". */
  resource: string;
}

export function SubscriptionError({ resource }: SubscriptionErrorProps) {
  return (
    <div className="alert alert-error" role="alert">
      Couldn&apos;t load {resource} &mdash; please refresh.
    </div>
  );
}

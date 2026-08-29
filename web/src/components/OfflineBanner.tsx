/**
 * "You're offline" banner (plan §1 "forgiving"; Phase 7b task deliverable
 * D). Rendered once from `AppShell`, above the page content, whenever
 * `navigator.onLine` is false — never blocks the UI, just warns that the
 * card on screen may be stale (there is no Firestore offline persistence,
 * plan §14.1, so a card shown while offline really is just the last thing
 * that loaded).
 */
import { useOnlineStatus } from '../lib/useOnlineStatus';

export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;

  return (
    <div className="alert alert-error" role="status">
      You&apos;re offline — the card may be out of date.
    </div>
  );
}

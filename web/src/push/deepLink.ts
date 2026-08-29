/**
 * Maps a push notification's `data` payload to an in-app route, so the
 * service worker's `notificationclick` handler (`sw.ts`) and the in-app
 * notifications feed agree on where a given notification goes.
 *
 * This intentionally mirrors `deepLinkFor` in
 * `../screens/NotificationsScreen.tsx` (which reads the exact same
 * `notifications/{id}.data` shape the server writes — see plan §11 and
 * `firebase/functions/src/entries/lib.ts` / `notifications/matchmaking.ts`
 * for the `{ sessionId, year }` / `{ inviteId }` shapes actually sent).
 * Kept as a separate, pure, dependency-free module (rather than importing
 * from `screens/`) so it can be bundled into the service worker, which runs
 * in a completely different global scope and must not pull in any
 * React/router code.
 *
 * Unlike the in-app feed (which has nothing sensible to fall back to and
 * simply does nothing), a clicked OS notification always opens *some* page —
 * so this returns `/notifications` rather than `null` when the payload
 * carries neither a session nor an invite id.
 */
export interface DeepLinkData {
  sessionId?: string;
  year?: string;
  inviteId?: string;
  [key: string]: string | undefined;
}

export function resolveDeepLink(data: DeepLinkData | undefined | null): string {
  const { sessionId, year, inviteId } = data ?? {};
  if (sessionId && year) return `/session/${encodeURIComponent(year)}/${encodeURIComponent(sessionId)}`;
  if (inviteId) return '/invites';
  return '/notifications';
}

/**
 * Shared-device safety: idle auto sign-out (plan §8.1 "Shared devices...
 * optional auto-lock after 30 days idle"; Phase 7b task deliverable C).
 * Pure, storage-agnostic helpers — `useIdleSignOut.ts` wires these to real
 * `localStorage` and DOM activity events.
 *
 * `localStorage` can throw (private browsing in some browsers, storage
 * quota, a locked-down shared-device policy) — every function here swallows
 * that and behaves as if there were simply no stored timestamp, per the
 * task brief ("if `localStorage` throws, skip").
 */

/** 30 days, in milliseconds. */
export const IDLE_SIGN_OUT_MS = 30 * 24 * 60 * 60 * 1000;

export const LAST_ACTIVITY_STORAGE_KEY = 'obc.lastActivityAt';

export interface ReadableStorage {
  getItem(key: string): string | null;
}

export interface WritableStorage {
  setItem(key: string, value: string): void;
}

/** The last-recorded activity time (epoch ms), or `null` if none is stored or storage is unavailable. */
export function readLastActivity(storage: ReadableStorage): number | null {
  try {
    const raw = storage.getItem(LAST_ACTIVITY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Records `now` as the last-activity time. Silently does nothing if storage throws. */
export function writeLastActivity(storage: WritableStorage, now: number): void {
  try {
    storage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(now));
  } catch {
    // Shared/locked-down devices may refuse writes — nothing sensible to do.
  }
}

/**
 * `true` only when there IS a recorded last-activity time and it is more
 * than 30 days before `now`. A brand-new device (nothing recorded yet)
 * never counts as idle-expired — there is nothing to expire.
 */
export function isIdleExpired(lastActivity: number | null, now: number): boolean {
  if (lastActivity == null) return false;
  return now - lastActivity > IDLE_SIGN_OUT_MS;
}

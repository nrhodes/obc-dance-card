/**
 * Why the signed-in user's own member doc could not be read.
 *
 * Firestore refuses the read with `permission-denied` in two very different
 * situations: the member has been deactivated (rules: `isActiveMember()`),
 * or App Check rejected this *browser* (enforced in production — every read
 * is refused, whoever is signed in). Showing "your membership is not active"
 * for the second is wrong and alarming, so the two are told apart by asking
 * App Check directly (`appCheckWorking()` in `firebase.ts`).
 */
export type MemberDocProblem =
  /** The rules refused it and App Check is healthy: not an active member. */
  | 'not-active'
  /** App Check could not verify this browser, so nothing can be read. */
  | 'browser-not-verified'
  /** Anything else (network, service unavailable, an unexpected code). */
  | 'unavailable'
  /**
   * The read never completed and a probe showed this browser reaches our
   * origin but not googleapis.com: an ad/privacy blocker or network filter
   * (`connectivity.ts`). Set by the stall timeout, never by this classifier.
   */
  | 'blocked';

export function classifyMemberDocError(firestoreCode: string | undefined, appCheckOk: boolean): MemberDocProblem {
  if (firestoreCode === 'permission-denied') {
    return appCheckOk ? 'not-active' : 'browser-not-verified';
  }
  return 'unavailable';
}

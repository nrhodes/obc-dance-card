/**
 * Cloud Functions entry point. Each phase of the build plan adds its callables
 * and triggers here; Phase 0 ships only a health check to prove the wiring.
 */
import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall } from 'firebase-functions/v2/https';

// Keep a tight lid on cost: never fan out to many instances for a club-sized load.
setGlobalOptions({ region: 'australia-southeast1', maxInstances: 5 });

export const ping = onCall((req) => {
  return {
    ok: true,
    at: new Date().toISOString(),
    authed: req.auth?.uid ?? null,
  };
});

/* Phase 1 — auth + members
 * export { requestLoginCode, verifyLoginCode } from './auth/emailCode.js';
 * export { beforeSignIn } from './auth/blocking.js';
 * export { importMembers } from './admin/importMembers.js';
 *
 * Phase 2 — programme
 * export { importProgramme, publishProgramme } from './admin/programme.js';
 *
 * Phase 3 — dance card
 * export { sendInvite, respondToInvite, cancelInvite } from './entries/invites.js';
 * export { setSoloStatus, cancelEntry, createPairing } from './entries/entries.js';
 *
 * Phase 4 — matchmaking + substitutes
 * export { setSubstitute } from './entries/substitute.js';
 *
 * Phase 5 — notifications
 * export { onNotificationCreated } from './notifications/dispatch.js';
 * export { sendSessionReminders } from './notifications/reminders.js';
 *
 * Phase 6 — admin extras + integrity
 * export { broadcast, setMemberRole } from './admin/misc.js';
 * export { verifyPairingConsistency } from './integrity/verifyPairings.js';
 */

/**
 * Cloud Functions entry point. Each phase of the build plan adds its callables
 * and triggers here; Phase 0.5 ships only a health check to prove the wiring.
 */
import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall } from 'firebase-functions/v2/https';
import { callableOptions } from './lib/callable.js';

// Keep a tight lid on cost: never fan out to many instances for a club-sized load.
setGlobalOptions({ region: 'australia-southeast1', maxInstances: 5 });

export const ping = onCall(callableOptions, (req) => {
  return {
    ok: true,
    at: new Date().toISOString(),
    authed: req.auth?.uid ?? null,
  };
});

// Phase 1 — auth + members
export { requestLoginCode, verifyLoginCode } from './auth/emailCode.js';
export { beforeUserCreated, beforeSignIn } from './auth/blocking.js';
export { markPasswordSet, removePassword } from './auth/password.js';
export { updateMyContact, updateMyPrefs, registerDevice, unregisterDevice } from './members/profile.js';
export { importMembers } from './admin/importMembers.js';

// Phase 2 — programme
export { importProgramme } from './admin/importProgramme.js';
export { publishProgramme } from './admin/programme.js';

// Phase 3a — dance card core
export { sendInvite, respondToInvite, cancelInvite } from './entries/invites.js';
export { setSoloStatus, clearSoloStatus, claimLookingForPartner, cancelEntry } from './entries/entries.js';
export { markNotificationsRead } from './notifications/read.js';

/*
 * Phase 4 — visitors + substitutes
 * export { createVisitor, updateVisitor, deleteVisitor, signUpWithVisitor } from './visitors/visitors.js';
 * export { setSubstitute, clearSubstitute } from './entries/substitute.js';
 *
 * Phase 4b — teams
 * export {
 *   createTeam,
 *   inviteToTeam,
 *   addVisitorToTeam,
 *   removeVisitorFromTeam,
 *   leaveTeam,
 *   removeFromTeam,
 *   transferCaptaincy,
 *   disbandTeam,
 *   addTeamSessionSubstitute,
 *   clearTeamSessionSubstitute,
 * } from './teams/teams.js';
 *
 * Phase 5 — notifications
 * export { onNotificationCreated } from './notifications/dispatch.js';
 * export { sendSessionReminders } from './notifications/reminders.js';
 *
 * Phase 6 — admin extras + integrity
 * export { broadcast, setMemberRole, deactivateMember, reactivateMember, eraseMember } from './admin/misc.js';
 * export { updateSeries, updateSession } from './admin/programme.js';
 * export { listAuditLog } from './admin/audit.js';
 * export { verifyPairingConsistency, purgeExpired } from './integrity/verifyPairings.js';
 * export { runPairingSweep } from './integrity/sweep.js';
 */

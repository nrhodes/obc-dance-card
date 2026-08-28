/**
 * Typed callable bindings for every Cloud Function this app invokes. Names
 * MUST match the deployed callable names in `firebase/functions/src` (plan
 * §9.2) — the input/result types come straight from `@obc/shared` so the
 * contract can never drift.
 */
import type {
  CancelEntryInput,
  CancelEntryResult,
  CancelInviteInput,
  CancelInviteResult,
  ClaimLookingForPartnerInput,
  ClaimLookingForPartnerResult,
  ClearSoloStatusInput,
  ClearSoloStatusResult,
  ImportMembersInput,
  ImportMembersResult,
  ImportProgrammeInput,
  ImportProgrammeResult,
  MarkNotificationsReadInput,
  MarkPasswordSetInput,
  PublishProgrammeInput,
  PublishProgrammeResult,
  RemovePasswordInput,
  RequestLoginCodeInput,
  RequestLoginCodeResult,
  RespondToInviteInput,
  RespondToInviteResult,
  SendInviteInput,
  SendInviteResult,
  SetSoloStatusInput,
  SetSoloStatusResult,
  UpdateMyContactInput,
  UpdateMyPrefsInput,
  VerifyLoginCodeInput,
  VerifyLoginCodeResult,
} from '@obc/shared';
import { callable } from './firebase';

export const requestLoginCode = callable<RequestLoginCodeInput, RequestLoginCodeResult>('requestLoginCode');
export const verifyLoginCode = callable<VerifyLoginCodeInput, VerifyLoginCodeResult>('verifyLoginCode');
export const markPasswordSet = callable<MarkPasswordSetInput, { ok: true }>('markPasswordSet');
export const removePassword = callable<RemovePasswordInput, { ok: true }>('removePassword');
export const updateMyContact = callable<UpdateMyContactInput, { ok: true }>('updateMyContact');
export const updateMyPrefs = callable<UpdateMyPrefsInput, { ok: true }>('updateMyPrefs');
export const importMembers = callable<ImportMembersInput, ImportMembersResult>('importMembers');
export const importProgramme = callable<ImportProgrammeInput, ImportProgrammeResult>('importProgramme');
export const publishProgramme = callable<PublishProgrammeInput, PublishProgrammeResult>('publishProgramme');

// Card core (plan §9.2, Phase 3b task)
export const sendInvite = callable<SendInviteInput, SendInviteResult>('sendInvite');
export const respondToInvite = callable<RespondToInviteInput, RespondToInviteResult>('respondToInvite');
export const cancelInvite = callable<CancelInviteInput, CancelInviteResult>('cancelInvite');
export const setSoloStatus = callable<SetSoloStatusInput, SetSoloStatusResult>('setSoloStatus');
export const clearSoloStatus = callable<ClearSoloStatusInput, ClearSoloStatusResult>('clearSoloStatus');
export const claimLookingForPartner = callable<ClaimLookingForPartnerInput, ClaimLookingForPartnerResult>(
  'claimLookingForPartner',
);
export const cancelEntry = callable<CancelEntryInput, CancelEntryResult>('cancelEntry');
export const markNotificationsRead = callable<MarkNotificationsReadInput, { ok: true }>('markNotificationsRead');

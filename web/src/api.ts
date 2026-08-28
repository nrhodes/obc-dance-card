/**
 * Typed callable bindings for every Cloud Function this app invokes. Names
 * MUST match the deployed callable names in `firebase/functions/src` (plan
 * §9.2) — the input/result types come straight from `@obc/shared` so the
 * contract can never drift.
 */
import type {
  ImportMembersInput,
  ImportMembersResult,
  MarkPasswordSetInput,
  RemovePasswordInput,
  RequestLoginCodeInput,
  RequestLoginCodeResult,
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

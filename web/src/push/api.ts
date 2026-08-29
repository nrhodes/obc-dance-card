/**
 * Callable bindings for the two device-registration functions (plan §9.2
 * `registerDevice` / `unregisterDevice`, implemented in
 * `firebase/functions/src/members/profile.ts`). Kept local to `push/`
 * (rather than added to the shared `../api.ts`) per this phase's file
 * ownership split — the contract itself still comes straight from
 * `@obc/shared`, so it can never drift from the deployed callables.
 */
import type { RegisterDeviceInput, UnregisterDeviceInput } from '@obc/shared';
import { callable } from '../firebase';

export const registerDevice = callable<RegisterDeviceInput, { ok: true }>('registerDevice');
export const unregisterDevice = callable<UnregisterDeviceInput, { ok: true }>('unregisterDevice');

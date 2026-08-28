/**
 * Maps backend/Firebase error codes to plain-English, display-safe copy.
 * Never surface a raw Firebase error string to the user (plan §8.1 / task
 * spec: "Never show raw Firebase error strings").
 */
import type { AppError } from '../firebase';

const TOO_MANY_ATTEMPTS = 'Too many attempts. Please wait a few minutes and try again.';
const INVALID_CODE = 'That code is not valid. Request a new one.';
const GENERIC = 'Something went wrong. Please try again.';
/** Deliberately identical for "unknown email" and "wrong password" (plan §8.1 enumeration). */
export const PASSWORD_MISMATCH =
  "That email and password don't match. You can sign in with an emailed code instead.";

/** For requestLoginCode / verifyLoginCode failures. */
export function mapCodeFlowError(err: AppError): string {
  switch (err.code) {
    case 'resource-exhausted':
      return TOO_MANY_ATTEMPTS;
    case 'invalid-argument':
      return INVALID_CODE;
    default:
      return GENERIC;
  }
}

/**
 * For `signInWithEmailAndPassword` failures. Deliberately ignores the
 * specific Firebase Auth error code — wrong password and unknown email must
 * look identical to the user (plan §8.1 enumeration protection).
 */
export function mapPasswordSignInError(_err: AppError): string {
  void _err;
  return PASSWORD_MISMATCH;
}

/** For any other, non-auth-flow-specific callable failure. */
export function mapGenericError(_err: AppError): string {
  void _err;
  return GENERIC;
}

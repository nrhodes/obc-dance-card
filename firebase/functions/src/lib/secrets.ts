/**
 * Cloud Functions secrets (Secret Manager, via `defineSecret`). Never read
 * these from `.env` or `process.env` directly — bind them on the callables
 * that need them (`onCall({ secrets: [LOGIN_CODE_PEPPER] }, ...)`), and access
 * with `.value()` only inside the handler.
 */
import { defineSecret } from 'firebase-functions/params';

/** HMAC pepper for hashing email login codes (plan §8.2). */
export const LOGIN_CODE_PEPPER = defineSecret('LOGIN_CODE_PEPPER');

/** API key for the transactional email provider (Postmark/SendGrid), when used. */
export const EMAIL_PROVIDER_KEY = defineSecret('EMAIL_PROVIDER_KEY');

/** Password for the Workspace SMTP relay, when `EMAIL_PROVIDER=smtp`. */
export const SMTP_PASS = defineSecret('SMTP_PASS');

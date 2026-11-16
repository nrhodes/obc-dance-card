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

/**
 * Login (mailbox address) for the SMTP relay, when `EMAIL_PROVIDER=smtp`.
 * Not sensitive like the password, but it is a personal mailbox address and
 * the production env file is committed to a public repository (plan §21 B12),
 * so it lives in Secret Manager rather than in `.env.<project>`.
 */
export const SMTP_USER = defineSecret('SMTP_USER');

/** Everything a function that may send email must bind (`secrets: [...]`). */
export const SMTP_SECRETS = [SMTP_PASS, SMTP_USER];

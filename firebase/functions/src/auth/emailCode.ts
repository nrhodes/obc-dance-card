/**
 * Emailed 6-digit login code (plan §8.2, §8.3, §9.2 `requestLoginCode` /
 * `verifyLoginCode`). No magic links — see `email/templates/loginCode.ts`.
 *
 * Handlers are exported unwrapped (`requestLoginCodeHandler` /
 * `verifyLoginCodeHandler`) alongside the deployed `onCall` exports so tests
 * can invoke them directly with a fake `CallableRequest` — see
 * `src/testing/README.md`.
 */
import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  RequestLoginCodeInputSchema,
  VerifyLoginCodeInputSchema,
  paths,
  type EmailLoginCode,
  type Member,
  type RequestLoginCodeInput,
  type RequestLoginCodeResult,
  type VerifyLoginCodeInput,
  type VerifyLoginCodeResult,
} from '@obc/shared';
import { auth, db } from '../lib/admin.js';
import { callableOptions } from '../lib/callable.js';
import { assertRateLimit } from '../lib/rateLimit.js';
import { logger } from '../lib/logger.js';
import { LOGIN_CODE_PEPPER, SMTP_PASS } from '../lib/secrets.js';
import { getEmailProvider } from '../email/provider.js';
import { loginCodeEmail } from '../email/templates/loginCode.js';

const TTL_MINUTES = Number(process.env.LOGIN_CODE_TTL_MINUTES ?? 10);
const MAX_ATTEMPTS = Number(process.env.LOGIN_CODE_MAX_ATTEMPTS ?? 5);
/** Target wall-clock time for `requestLoginCode` regardless of outcome (plan §8.2). */
const UNIFORM_RESPONSE_TARGET_MS = 400;

const INVALID_CODE_MESSAGE = 'That code is not valid. Request a new one.';

function emailDocId(emailLower: string): string {
  return createHash('sha256').update(emailLower).digest('hex');
}

function computeCodeHmac(pepper: string, emailLower: string, code: string): string {
  return createHmac('sha256', pepper).update(`${emailLower}:${code}`).digest('hex');
}

/** First value of `x-forwarded-for`, falling back to the raw connection IP. */
function clientIp(req: CallableRequest): string {
  const forwarded = req.rawRequest?.headers?.['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof first === 'string' && first.length > 0) {
    return first.split(',')[0]!.trim();
  }
  return req.rawRequest?.ip ?? 'unknown';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function requestLoginCodeHandler(
  req: CallableRequest<RequestLoginCodeInput>,
): Promise<RequestLoginCodeResult> {
  const start = Date.now();
  const input = RequestLoginCodeInputSchema.parse(req.data);
  const emailLower = input.email;
  const ip = clientIp(req);

  // Rate limits first (plan §8.2 step 2) — a burst is rejected immediately,
  // deliberately breaking the uniform-timing guarantee below, which only
  // covers the known-vs-unknown-email distinction.
  // Per-email limit is the real brute-force/bombing control. The per-IP limit
  // is deliberately loose: the club's own wifi puts many members behind one
  // NAT address on a session afternoon.
  await assertRateLimit('loginCode:email', emailLower, 3, 15 * 60);
  await assertRateLimit('loginCode:requestIp', ip, 30, 60 * 60);

  let uid: string | undefined;
  try {
    const userRecord = await auth.getUserByEmail(emailLower);
    uid = userRecord.uid;
  } catch {
    uid = undefined;
  }

  let isActiveMember = false;
  if (uid) {
    const memberSnap = await db.doc(paths.member(uid)).get();
    const member = memberSnap.data() as Member | undefined;
    isActiveMember = member?.active === true;
  }

  if (uid && isActiveMember) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHmac = computeCodeHmac(LOGIN_CODE_PEPPER.value(), emailLower, code);
    const doc: EmailLoginCode = {
      id: emailDocId(emailLower),
      codeHmac,
      expiresAt: new Date(start + TTL_MINUTES * 60_000).toISOString(),
      attempts: 0,
      createdAt: new Date().toISOString(),
    };
    // Overwrite any prior doc for this email (plan §8.2: "new request
    // invalidates old").
    await db.collection('emailCodes').doc(doc.id).set(doc);

    const email = loginCodeEmail(code);
    await getEmailProvider().send({ to: emailLower, subject: email.subject, text: email.text, html: email.html });
  }

  // Generic event with no field that identifies the email, known or not.
  logger.info('login_code_requested', {});

  const elapsed = Date.now() - start;
  const remaining = UNIFORM_RESPONSE_TARGET_MS - elapsed;
  if (remaining > 0) {
    await sleep(remaining);
  }

  return { ok: true };
}

export const requestLoginCode = onCall(
  { ...callableOptions, secrets: [LOGIN_CODE_PEPPER, SMTP_PASS] },
  requestLoginCodeHandler,
);

export async function verifyLoginCodeHandler(
  req: CallableRequest<VerifyLoginCodeInput>,
): Promise<VerifyLoginCodeResult> {
  const input = VerifyLoginCodeInputSchema.parse(req.data);
  const emailLower = input.email;
  const ip = clientIp(req);

  await assertRateLimit('loginCode:verifyEmail', emailLower, 10, 15 * 60);
  await assertRateLimit('loginCode:verifyIp', ip, 60, 60 * 60);

  const pepper = LOGIN_CODE_PEPPER.value();
  const ref = db.collection('emailCodes').doc(emailDocId(emailLower));

  const ok = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;

    const data = snap.data() as EmailLoginCode;
    const attempts = data.attempts + 1;

    if (attempts > MAX_ATTEMPTS) {
      tx.delete(ref);
      return false;
    }
    tx.update(ref, { attempts });

    if (data.consumedAt) return false;
    if (new Date(data.expiresAt).getTime() < Date.now()) return false;

    const expected = Buffer.from(computeCodeHmac(pepper, emailLower, input.code), 'hex');
    const actual = Buffer.from(data.codeHmac, 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return false;
    }

    tx.update(ref, { consumedAt: new Date().toISOString() });
    return true;
  });

  if (!ok) {
    throw new HttpsError('invalid-argument', INVALID_CODE_MESSAGE);
  }

  // The emailCodes doc is keyed by email hash only (no uid) — re-resolve.
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(emailLower);
  } catch {
    // The code matched, but the account has vanished since it was issued.
    throw new HttpsError('invalid-argument', INVALID_CODE_MESSAGE);
  }

  // Defence in depth: the code was only issued to an active member, but the
  // member may have been deactivated inside the code's 10-minute window.
  // (`beforeSignIn` would also reject the custom token, but do not rely on it.)
  const memberSnap = await db.doc(paths.member(userRecord.uid)).get();
  const member = memberSnap.data() as Member | undefined;
  if (!member || member.active !== true || userRecord.disabled) {
    throw new HttpsError('invalid-argument', INVALID_CODE_MESSAGE);
  }

  const token = await auth.createCustomToken(userRecord.uid);
  await db
    .doc(paths.memberPrivate(userRecord.uid))
    .set({ lastLoginAt: new Date().toISOString() }, { merge: true });

  return { token };
}

export const verifyLoginCode = onCall(
  { ...callableOptions, secrets: [LOGIN_CODE_PEPPER, SMTP_PASS] },
  verifyLoginCodeHandler,
);

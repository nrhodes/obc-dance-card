process.env.LOGIN_CODE_PEPPER = 'test-pepper';
process.env.NODE_ENV = 'test';

import { createHash, createHmac } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { EmailLoginCode, RequestLoginCodeInput, VerifyLoginCodeInput } from '@obc/shared';
import { paths } from '@obc/shared';
import { initializeApp as initClientApp } from 'firebase/app';
import { connectAuthEmulator, getAuth as getClientAuth, signInWithCustomToken } from 'firebase/auth';
import { db } from '../lib/admin.js';
import { fakeCallableRequest, makeMember } from '../testing/fixtures.js';
import { requestLoginCodeHandler, verifyLoginCodeHandler } from './emailCode.js';

// Local re-implementation of the emailCodes doc-id derivation (sha256 of the
// lower-cased email) so the test doesn't need to import a private helper.
function emailDocId(emailLower: string): string {
  return createHash('sha256').update(emailLower).digest('hex');
}

async function wipeRateLimits(): Promise<void> {
  const snap = await db.collection('rateLimits').get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

async function wipeEmailCodes(): Promise<void> {
  const snap = await db.collection('emailCodes').get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

describe('requestLoginCode / verifyLoginCode', () => {
  beforeEach(async () => {
    await wipeRateLimits();
    await wipeEmailCodes();
  });

  it('unknown email: returns {ok:true}, stores no code, and takes ~400ms', async () => {
    const start = Date.now();
    const result = await requestLoginCodeHandler(
      fakeCallableRequest<RequestLoginCodeInput>({ email: 'nobody@example.org' }, { ip: '203.0.113.9' }),
    );
    const elapsed = Date.now() - start;

    expect(result).toEqual({ ok: true });
    expect(elapsed).toBeGreaterThanOrEqual(350);

    const snap = await db.collection('emailCodes').doc(emailDocId('nobody@example.org')).get();
    expect(snap.exists).toBe(false);
  }, 10_000);

  it('known active email: request stores a code doc whose hmac does not equal the raw code', async () => {
    const email = 'lifecycle1@example.org';
    await makeMember(email);

    await requestLoginCodeHandler(fakeCallableRequest<RequestLoginCodeInput>({ email }, { ip: '203.0.113.10' }));

    const snap = await db.collection('emailCodes').doc(emailDocId(email)).get();
    expect(snap.exists).toBe(true);
    const data = snap.data() as EmailLoginCode;
    expect(data.codeHmac).not.toBe('');
    // The stored value is a hex HMAC, never the plain 6-digit code.
    expect(/^\d{6}$/.test(data.codeHmac)).toBe(false);
    expect(data.attempts).toBe(0);
  });

  it('wrong code increments attempts; the 6th wrong attempt deletes the doc', async () => {
    const email = 'lifecycle2@example.org';
    await makeMember(email);
    await requestLoginCodeHandler(fakeCallableRequest<RequestLoginCodeInput>({ email }, { ip: '203.0.113.11' }));

    const docRef = db.collection('emailCodes').doc(emailDocId(email));

    for (let i = 1; i <= 5; i++) {
      await expect(
        verifyLoginCodeHandler(fakeCallableRequest<VerifyLoginCodeInput>({ email, code: '000000' }, { ip: '203.0.113.11' })),
      ).rejects.toMatchObject({ code: 'invalid-argument' });
      if (i < 5) {
        const snap = await docRef.get();
        expect(snap.exists).toBe(true);
        expect((snap.data() as EmailLoginCode).attempts).toBe(i);
      }
    }

    // The 6th attempt (attempts now > MAX_ATTEMPTS=5) deletes the doc.
    await expect(
      verifyLoginCodeHandler(fakeCallableRequest<VerifyLoginCodeInput>({ email, code: '000000' }, { ip: '203.0.113.11' })),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    const snap = await docRef.get();
    expect(snap.exists).toBe(false);
  });

  it('expired code is rejected', async () => {
    const email = 'lifecycle3@example.org';
    await makeMember(email);
    const codeHmac = createHmac('sha256', 'test-pepper').update(`${email}:123456`).digest('hex');
    const doc: EmailLoginCode = {
      id: emailDocId(email),
      codeHmac,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      attempts: 0,
      createdAt: new Date().toISOString(),
    };
    await db.collection('emailCodes').doc(doc.id).set(doc);

    await expect(
      verifyLoginCodeHandler(fakeCallableRequest<VerifyLoginCodeInput>({ email, code: '123456' }, { ip: '203.0.113.12' })),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('consumed code is rejected on a second use', async () => {
    const email = 'lifecycle4@example.org';
    await makeMember(email);
    const codeHmac = createHmac('sha256', 'test-pepper').update(`${email}:654321`).digest('hex');
    const doc: EmailLoginCode = {
      id: emailDocId(email),
      codeHmac,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      attempts: 0,
      createdAt: new Date().toISOString(),
      consumedAt: new Date().toISOString(),
    };
    await db.collection('emailCodes').doc(doc.id).set(doc);

    await expect(
      verifyLoginCodeHandler(fakeCallableRequest<VerifyLoginCodeInput>({ email, code: '654321' }, { ip: '203.0.113.13' })),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('correct code returns a token accepted by the Auth emulator, and sets lastLoginAt', async () => {
    const email = 'lifecycle5@example.org';
    const uid = await makeMember(email);

    // Seed a code doc with a known code (mirrors what requestLoginCode would
    // have stored — its own generated code isn't observable from outside).
    const code = '424242';
    const codeHmac = createHmac('sha256', 'test-pepper').update(`${email}:${code}`).digest('hex');
    const doc: EmailLoginCode = {
      id: emailDocId(email),
      codeHmac,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      attempts: 0,
      createdAt: new Date().toISOString(),
    };
    await db.collection('emailCodes').doc(doc.id).set(doc);

    const result = await verifyLoginCodeHandler(
      fakeCallableRequest<VerifyLoginCodeInput>({ email, code }, { ip: '203.0.113.14' }),
    );
    expect(typeof result.token).toBe('string');

    const privateSnap = await db.doc(paths.memberPrivate(uid)).get();
    expect(privateSnap.data()?.lastLoginAt).toBeTruthy();

    // The token must actually be accepted by the Auth emulator.
    const clientApp = initClientApp(
      { apiKey: 'fake-api-key', projectId: process.env.GCLOUD_PROJECT ?? 'demo-obc' },
      `client-${uid}`,
    );
    const clientAuth = getClientAuth(clientApp);
    const [authHost, authPortStr] = (process.env.FIREBASE_AUTH_EMULATOR_HOST ?? 'localhost:9099').split(':');
    connectAuthEmulator(clientAuth, `http://${authHost}:${authPortStr}`, { disableWarnings: true });
    const signedIn = await signInWithCustomToken(clientAuth, result.token);
    expect(signedIn.user.uid).toBe(uid);
  });

  it('rate limit: a 4th request within 15 minutes for the same email is rejected', async () => {
    const email = 'ratelimited@example.org';
    await makeMember(email);

    for (let i = 0; i < 3; i++) {
      await requestLoginCodeHandler(fakeCallableRequest<RequestLoginCodeInput>({ email }, { ip: '203.0.113.20' }));
    }

    await expect(
      requestLoginCodeHandler(fakeCallableRequest<RequestLoginCodeInput>({ email }, { ip: '203.0.113.20' })),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
  }, 15_000);
});

afterAll(async () => {
  // no-op: emulators:exec tears the emulator down for us.
});

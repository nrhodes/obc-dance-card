/**
 * Enumeration defence for `requestLoginCode` (plan §8.2; security review
 * 2026-11-16, M2): a known-and-active email and an unknown email must cost
 * the same wall-clock time. Two mechanisms are asserted here with a mocked
 * email provider whose `send()` and `warm()` both take a controllable time:
 *
 *  - equal work: the unknown path calls `warm()` (one handshake), the known
 *    path calls `send()` (one handshake + DATA), never both;
 *  - the floor: when the provider is fast, both paths take at least the
 *    uniform floor; when the provider is *slower* than the floor (the case
 *    the 400 ms pad got wrong), both paths still take about the same time
 *    because they did the same work.
 */
process.env.LOGIN_CODE_PEPPER = 'test-pepper';
process.env.NODE_ENV = 'test';
process.env.LOGIN_CODE_UNIFORM_RESPONSE_MS = '600';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestLoginCodeInput } from '@obc/shared';
import type * as ProviderModule from '../email/provider.js';

const providerDelay = { ms: 0 };
const send = vi.fn(async () => {
  await new Promise((r) => setTimeout(r, providerDelay.ms));
});
const warm = vi.fn(async () => {
  await new Promise((r) => setTimeout(r, providerDelay.ms));
});

vi.mock('../email/provider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ProviderModule>();
  return { ...actual, getEmailProvider: () => ({ send, warm }) };
});

const { db } = await import('../lib/admin.js');
const { fakeCallableRequest, makeMember } = await import('../testing/fixtures.js');
const { requestLoginCodeHandler } = await import('./emailCode.js');

async function wipeRateLimits(): Promise<void> {
  const snap = await db.collection('rateLimits').get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

async function timed(email: string, ip: string): Promise<number> {
  const start = Date.now();
  await requestLoginCodeHandler(fakeCallableRequest<RequestLoginCodeInput>({ email }, { ip }));
  return Date.now() - start;
}

describe('requestLoginCode timing uniformity', () => {
  beforeEach(async () => {
    await wipeRateLimits();
    send.mockClear();
    warm.mockClear();
    providerDelay.ms = 0;
  });

  it('unknown email warms the provider once and never sends; known email sends once and never warms', async () => {
    const known = 'timing-known-1@example.org';
    await makeMember(known);

    await timed('timing-unknown-1@example.org', '203.0.113.21');
    expect(warm).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();

    warm.mockClear();
    await timed(known, '203.0.113.22');
    expect(send).toHaveBeenCalledTimes(1);
    expect(warm).not.toHaveBeenCalled();
  }, 15_000);

  it('with a fast provider both paths take at least the floor', async () => {
    const known = 'timing-known-2@example.org';
    await makeMember(known);

    const unknownMs = await timed('timing-unknown-2@example.org', '203.0.113.23');
    const knownMs = await timed(known, '203.0.113.24');

    expect(unknownMs).toBeGreaterThanOrEqual(550);
    expect(knownMs).toBeGreaterThanOrEqual(550);
  }, 15_000);

  it('with a provider slower than the floor both paths still take about the same time', async () => {
    const known = 'timing-known-3@example.org';
    await makeMember(known);
    providerDelay.ms = 1500; // > the 600 ms floor set above

    const unknownMs = await timed('timing-unknown-3@example.org', '203.0.113.25');
    const knownMs = await timed(known, '203.0.113.26');

    expect(unknownMs).toBeGreaterThanOrEqual(1500);
    expect(knownMs).toBeGreaterThanOrEqual(1500);
    // The residual difference is the known path's Firestore write and the
    // member-doc read — tens of milliseconds, not a relay round-trip.
    expect(Math.abs(knownMs - unknownMs)).toBeLessThan(400);
  }, 20_000);
});

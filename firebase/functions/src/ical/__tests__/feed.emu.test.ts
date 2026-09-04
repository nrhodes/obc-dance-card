import { describe, expect, it } from 'vitest';
import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import type { CreateIcalFeedInput, Entry, RotateIcalFeedInput } from '@obc/shared';
import { paths } from '@obc/shared';
import { db } from '../../lib/admin.js';
import { entryId } from '../../entries/lib.js';
import {
  fakeCallableRequest,
  makeMember,
  makeProgramme,
  sessionInFuture,
} from '../../testing/fixtures.js';
import { createIcalFeedHandler, rotateIcalFeedHandler } from '../tokens.js';
import { icalFeedHandler } from '../feed.js';

/** Minimal stand-in for the express `Response` the handler is given by `onRequest`. */
interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string | undefined;
  status(code: number): FakeResponse;
  set(field: string, value: string): FakeResponse;
  send(body?: string): void;
  end(): void;
}

function fakeResponse(): FakeResponse {
  const res: FakeResponse = {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      res.statusCode = code;
      return res;
    },
    set(field, value) {
      res.headers[field] = value;
      return res;
    },
    send(body) {
      res.body = body;
    },
    end() {
      // no body
    },
  };
  return res;
}

function fakeRequest(opts: { path: string; method?: string; ip?: string }): Request {
  return {
    method: opts.method ?? 'GET',
    path: opts.path,
    ip: opts.ip ?? '203.0.113.50',
    headers: {},
  } as unknown as Request;
}

function tokenFromUrl(url: string): string {
  const match = /\/ical\/([^/]+)\.ics$/.exec(url);
  if (!match) throw new Error(`could not extract token from url: ${url}`);
  return match[1]!;
}

function baseEntry(sessionId: string, memberId: string, date: string, weekday: Entry['weekday']): Entry {
  const now = new Date().toISOString();
  return {
    id: entryId(sessionId, memberId),
    sessionId,
    date,
    weekday,
    seriesId: null,
    memberId,
    status: 'confirmed',
    partner: null,
    pairingId: null,
    teamId: null,
    teamSessionOnly: false,
    substitute: null,
    partnerSubstitute: null,
    isSubstituteFor: null,
    createdBy: memberId,
    createdAt: now,
    updatedAt: now,
  };
}

async function wipeRateLimits(): Promise<void> {
  const snap = await db.collection('rateLimits').get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

describe('icalFeed HTTP endpoint (plan §21 B1)', () => {
  it('unknown token: uniform 404', async () => {
    const res = fakeResponse();
    await icalFeedHandler(fakeRequest({ path: `/ical/${'a'.repeat(43)}.ics` }), res as unknown as Response);
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe('Not found');
  });

  it('syntactically invalid token (wrong length): uniform 404, same body as unknown token', async () => {
    const res = fakeResponse();
    await icalFeedHandler(fakeRequest({ path: '/ical/tooshort.ics' }), res as unknown as Response);
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe('Not found');
  });

  it('a method other than GET/HEAD is rejected with 405', async () => {
    const res = fakeResponse();
    await icalFeedHandler(fakeRequest({ path: `/ical/${'a'.repeat(43)}.ics`, method: 'POST' }), res as unknown as Response);
    expect(res.statusCode).toBe(405);
    expect(res.headers['Allow']).toBe('GET, HEAD');
  });

  it('create -> get -> rotate -> remove lifecycle: serves a confirmed entry as CONFIRMED and an lfp entry as TENTATIVE, then the old token 404s after rotate', async () => {
    const uid = await makeMember('ical-feed-lifecycle@example.org');
    const otherUid = await makeMember('ical-feed-partner@example.org', { firstName: 'Pat', lastName: 'Partner' });

    const d1 = sessionInFuture('monday', 4);
    const d2 = sessionInFuture('monday', 5);
    const d3 = sessionInFuture('monday', 6);
    const d4 = sessionInFuture('monday', 7);
    const prog = await makeProgramme({ dates: [d1, d2, d3, d4] });

    // Confirmed, paired — should appear as STATUS:CONFIRMED.
    await db.doc(paths.entry(entryId(prog.sessionIds[0]!, uid))).set({
      ...baseEntry(prog.sessionIds[0]!, uid, d1, prog.weekday),
      status: 'confirmed',
      partner: { kind: 'member', memberId: otherUid, displayName: 'Pat Partner' },
      pairingId: 'pairing-1',
    });
    // looking_for_partner — should appear as STATUS:TENTATIVE with the suffix.
    await db.doc(paths.entry(entryId(prog.sessionIds[1]!, uid))).set({
      ...baseEntry(prog.sessionIds[1]!, uid, d2, prog.weekday),
      status: 'looking_for_partner',
    });
    // unavailable — must be skipped entirely (never on the feed).
    await db.doc(paths.entry(entryId(prog.sessionIds[2]!, uid))).set({
      ...baseEntry(prog.sessionIds[2]!, uid, d3, prog.weekday),
      status: 'unavailable',
    });
    // cancelled — must be skipped entirely.
    await db.doc(paths.entry(entryId(prog.sessionIds[3]!, uid))).set({
      ...baseEntry(prog.sessionIds[3]!, uid, d4, prog.weekday),
      status: 'cancelled',
    });

    const created = await createIcalFeedHandler(fakeCallableRequest<CreateIcalFeedInput>({}, { uid }));
    const token1 = tokenFromUrl(created.url);

    const res1 = fakeResponse();
    await icalFeedHandler(fakeRequest({ path: `/ical/${token1}.ics` }), res1 as unknown as Response);
    expect(res1.statusCode).toBe(200);
    expect(res1.headers['Content-Type']).toBe('text/calendar; charset=utf-8');
    expect(res1.headers['Content-Disposition']).toContain('obc-bridge.ics');
    const body1 = res1.body!;
    expect(body1).toContain('BEGIN:VCALENDAR');
    expect(body1).toContain('END:VCALENDAR');
    const eventCount = body1.split('BEGIN:VEVENT').length - 1;
    expect(eventCount).toBe(2); // only the confirmed + lfp entries, never unavailable/cancelled
    expect(body1).toContain('STATUS:CONFIRMED');
    expect(body1).toContain('STATUS:TENTATIVE');
    expect(body1).toContain('with Pat Partner');
    expect(body1).toContain('(looking for a partner)');

    // HEAD: same status/headers, no body.
    const resHead = fakeResponse();
    await icalFeedHandler(fakeRequest({ path: `/ical/${token1}.ics`, method: 'HEAD' }), resHead as unknown as Response);
    expect(resHead.statusCode).toBe(200);
    expect(resHead.body).toBeUndefined();

    // Rotate: the old token must now 404, uniformly.
    const rotated = await rotateIcalFeedHandler(fakeCallableRequest<RotateIcalFeedInput>({}, { uid }));
    const token2 = tokenFromUrl(rotated.url);
    expect(token2).not.toBe(token1);

    const resOld = fakeResponse();
    await icalFeedHandler(fakeRequest({ path: `/ical/${token1}.ics` }), resOld as unknown as Response);
    expect(resOld.statusCode).toBe(404);
    expect(resOld.body).toBe('Not found');

    const resNew = fakeResponse();
    await icalFeedHandler(fakeRequest({ path: `/ical/${token2}.ics` }), resNew as unknown as Response);
    expect(resNew.statusCode).toBe(200);
    expect(resNew.body).toContain('BEGIN:VCALENDAR');
  });

  it('a deactivated member’s feed 404s immediately, even with a valid token', async () => {
    const uid = await makeMember('ical-feed-deactivated@example.org');
    const created = await createIcalFeedHandler(fakeCallableRequest<CreateIcalFeedInput>({}, { uid }));
    const token = tokenFromUrl(created.url);

    // Sanity: works while active.
    const resActive = fakeResponse();
    await icalFeedHandler(fakeRequest({ path: `/ical/${token}.ics` }), resActive as unknown as Response);
    expect(resActive.statusCode).toBe(200);

    await db.doc(paths.member(uid)).set({ active: false }, { merge: true });

    const resInactive = fakeResponse();
    await icalFeedHandler(fakeRequest({ path: `/ical/${token}.ics` }), resInactive as unknown as Response);
    expect(resInactive.statusCode).toBe(404);
    expect(resInactive.body).toBe('Not found');
  });

  it('tolerates a direct-function-URL shape (no /ical prefix)', async () => {
    const uid = await makeMember('ical-feed-directurl@example.org');
    const created = await createIcalFeedHandler(fakeCallableRequest<CreateIcalFeedInput>({}, { uid }));
    const token = tokenFromUrl(created.url);

    const res = fakeResponse();
    await icalFeedHandler(fakeRequest({ path: `/${token}.ics` }), res as unknown as Response);
    expect(res.statusCode).toBe(200);
  });

  it('rate-limits at 60 requests/hour per token, returning 429 with Retry-After', async () => {
    await wipeRateLimits();
    const uid = await makeMember('ical-feed-ratelimit@example.org');
    const created = await createIcalFeedHandler(fakeCallableRequest<CreateIcalFeedInput>({}, { uid }));
    const token = tokenFromUrl(created.url);
    const path = `/ical/${token}.ics`;

    for (let i = 0; i < 60; i++) {
      const res = fakeResponse();
      await icalFeedHandler(fakeRequest({ path }), res as unknown as Response);
      expect(res.statusCode, `request ${i + 1} of 60`).toBe(200);
    }

    const res61 = fakeResponse();
    await icalFeedHandler(fakeRequest({ path }), res61 as unknown as Response);
    expect(res61.statusCode).toBe(429);
    expect(res61.headers['Retry-After']).toBeTruthy();
  }, 60_000);
});

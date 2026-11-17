import { describe, expect, it } from 'vitest';
import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { versionHandler } from './version.js';

function fakeResponse() {
  const res = { status: 0, headers: {} as Record<string, string>, body: '' as string | undefined, ended: false };
  const r = {
    status(code: number) { res.status = code; return r; },
    set(key: string, value: string) { res.headers[key] = value; return r; },
    send(body: string) { res.body = body; },
    end() { res.ended = true; },
  };
  return { res, r: r as unknown as Response };
}

describe('version endpoint', () => {
  it('reports the build commit as JSON, uncached', () => {
    const { res, r } = fakeResponse();
    versionHandler({ method: 'GET' } as Request, r);
    expect(res.status).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    const body = JSON.parse(res.body!);
    expect(typeof body.commit).toBe('string');
    expect(typeof body.builtAt).toBe('string');
    // Not bundled under vitest, so the fallback applies.
    expect(body.commit).toBe('unknown');
  });

  it('answers HEAD without a body and refuses other methods', () => {
    const head = fakeResponse();
    versionHandler({ method: 'HEAD' } as Request, head.r);
    expect(head.res.status).toBe(200);
    expect(head.res.ended).toBe(true);
    const post = fakeResponse();
    versionHandler({ method: 'POST' } as Request, post.r);
    expect(post.res.status).toBe(405);
    expect(post.res.headers.Allow).toBe('GET, HEAD');
  });
});

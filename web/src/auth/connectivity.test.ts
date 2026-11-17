import { describe, expect, it, vi } from 'vitest';
import { classifyStall } from './connectivity';

function fakeFetch(outcomes: Record<string, boolean>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const key = Object.keys(outcomes).find((k) => url.includes(k));
    if (key && outcomes[key]) return new Response(null, { status: 200 });
    throw new TypeError('Failed to fetch');
  }) as unknown as typeof fetch;
}

describe('classifyStall', () => {
  it('is "blocked" when our origin answers but googleapis is refused', async () => {
    expect(await classifyStall(fakeFetch({ 'version.json': true, 'googleapis.com': false }))).toBe('blocked');
  });

  it('is "unavailable" when nothing answers (offline / captive portal)', async () => {
    expect(await classifyStall(fakeFetch({ 'version.json': false, 'googleapis.com': false }))).toBe('unavailable');
  });

  it('is "unavailable" when googleapis answers — the stall is something else', async () => {
    expect(await classifyStall(fakeFetch({ 'version.json': true, 'googleapis.com': true }))).toBe('unavailable');
  });
});

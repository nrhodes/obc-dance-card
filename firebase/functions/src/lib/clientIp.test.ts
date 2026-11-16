import { afterEach, describe, expect, it } from 'vitest';
import { clientIpFromForwardedFor, forwardedForEntries, trustedHopsFromEnv } from './clientIp.js';

describe('clientIpFromForwardedFor', () => {
  it('falls back to the connection address when the header is absent or empty', () => {
    expect(clientIpFromForwardedFor(undefined, '203.0.113.1', 0)).toBe('203.0.113.1');
    expect(clientIpFromForwardedFor('', '203.0.113.1', 0)).toBe('203.0.113.1');
    expect(clientIpFromForwardedFor(' , ', '203.0.113.1', 0)).toBe('203.0.113.1');
    expect(clientIpFromForwardedFor(undefined, undefined, 0)).toBe('unknown');
  });

  it('with no trusted hops takes the LAST entry — the one the platform appended', () => {
    // A caller trying to pick its own bucket by prepending addresses.
    expect(clientIpFromForwardedFor('1.1.1.1, 2.2.2.2, 203.0.113.9', '10.0.0.1', 0)).toBe('203.0.113.9');
    expect(clientIpFromForwardedFor('203.0.113.9', '10.0.0.1', 0)).toBe('203.0.113.9');
  });

  it('with one trusted hop (Hosting rewrite) takes the second-to-last entry', () => {
    expect(clientIpFromForwardedFor('1.1.1.1, 203.0.113.9, 35.1.2.3', '10.0.0.1', 1)).toBe('203.0.113.9');
  });

  it('with fewer entries than hops uses the leftmost surviving entry (honest direct call)', () => {
    expect(clientIpFromForwardedFor('203.0.113.9', '10.0.0.1', 1)).toBe('203.0.113.9');
    expect(clientIpFromForwardedFor('203.0.113.9', '10.0.0.1', 5)).toBe('203.0.113.9');
  });

  it('accepts a repeated header (array) and tolerates whitespace', () => {
    expect(clientIpFromForwardedFor(['1.1.1.1', ' 203.0.113.9 '], '10.0.0.1', 0)).toBe('203.0.113.9');
    expect(forwardedForEntries([' a ,b', '', 'c '])).toEqual(['a', 'b', 'c']);
  });

  it('treats a negative or non-numeric hop count as zero', () => {
    expect(clientIpFromForwardedFor('1.1.1.1, 203.0.113.9', '10.0.0.1', -3)).toBe('203.0.113.9');
    expect(clientIpFromForwardedFor('1.1.1.1, 203.0.113.9', '10.0.0.1', Number.NaN)).toBe('203.0.113.9');
  });
});

describe('trustedHopsFromEnv', () => {
  const name = 'TEST_TRUSTED_PROXY_HOPS';
  afterEach(() => {
    delete process.env[name];
  });

  it('reads a non-negative integer and otherwise returns the default', () => {
    process.env[name] = '2';
    expect(trustedHopsFromEnv(name, 0)).toBe(2);
    process.env[name] = '-1';
    expect(trustedHopsFromEnv(name, 1)).toBe(1);
    process.env[name] = 'lots';
    expect(trustedHopsFromEnv(name, 1)).toBe(1);
    delete process.env[name];
    expect(trustedHopsFromEnv(name, 0)).toBe(0);
  });
});

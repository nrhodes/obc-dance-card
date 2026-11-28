import { describe, expect, it } from 'vitest';
import { APP_VERSION, formatBuiltAt, shortCommit } from './appVersion';

describe('appVersion', () => {
  it('shortens a full commit hash and passes anything else through', () => {
    expect(shortCommit('455ba94c0ffee455ba94c0ffee455ba94c0ffee4')).toBe('455ba94');
    expect(shortCommit('unknown')).toBe('unknown');
    expect(shortCommit('')).toBe('unknown');
  });

  it('formats the build time in New Zealand time', () => {
    // 00:21 UTC on 28 Nov is 1:21 pm NZDT the same day.
    expect(formatBuiltAt('2026-11-28T00:21:42.607Z')).toMatch(/^28 Nov 2026, 1:21\s?pm$/i);
    expect(formatBuiltAt('not a date')).toBe('');
  });

  it('is baked into the bundle at build time', () => {
    expect(APP_VERSION.commit.length).toBeGreaterThan(0);
  });
});

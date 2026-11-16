import { describe, expect, it } from 'vitest';
import { classifyMemberDocError } from './memberDocError';

describe('classifyMemberDocError', () => {
  it('treats a refused read as "not active" only when App Check is healthy', () => {
    expect(classifyMemberDocError('permission-denied', true)).toBe('not-active');
  });

  it('blames the browser, not the membership, when App Check is failing', () => {
    expect(classifyMemberDocError('permission-denied', false)).toBe('browser-not-verified');
  });

  it('reports every other failure as temporarily unavailable', () => {
    expect(classifyMemberDocError('unavailable', true)).toBe('unavailable');
    expect(classifyMemberDocError('unavailable', false)).toBe('unavailable');
    expect(classifyMemberDocError(undefined, true)).toBe('unavailable');
  });
});

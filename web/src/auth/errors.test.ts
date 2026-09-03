import { describe, expect, it } from 'vitest';
import { mapCodeFlowError, mapGenericError, mapPasswordSignInError, PASSWORD_MISMATCH } from './errors';

describe('mapCodeFlowError', () => {
  it('maps resource-exhausted to a rate-limit message', () => {
    expect(mapCodeFlowError({ code: 'resource-exhausted', message: 'x' })).toMatch(/Too many attempts/);
  });

  it('maps a Cloud Run 429 (unavailable) / timeout to a "busy" message, not the generic one', () => {
    expect(mapCodeFlowError({ code: 'unavailable', message: 'x' })).toMatch(/busy/i);
    expect(mapCodeFlowError({ code: 'deadline-exceeded', message: 'x' })).toMatch(/busy/i);
  });

  it('maps invalid-argument to an invalid-code message', () => {
    expect(mapCodeFlowError({ code: 'invalid-argument', message: 'x' })).toMatch(/not valid/);
  });

  it('maps anything else to a generic message with no raw detail', () => {
    const msg = mapCodeFlowError({ code: 'internal', message: 'some raw firebase detail' });
    expect(msg).toMatch(/Something went wrong/);
    expect(msg).not.toContain('raw firebase detail');
  });
});

describe('mapPasswordSignInError', () => {
  it('returns the same generic mismatch message for unknown-user and wrong-password alike', () => {
    const unknownUser = mapPasswordSignInError({ code: 'auth/user-not-found', message: 'no user' });
    const wrongPassword = mapPasswordSignInError({ code: 'auth/wrong-password', message: 'bad password' });
    expect(unknownUser).toBe(PASSWORD_MISMATCH);
    expect(wrongPassword).toBe(PASSWORD_MISMATCH);
    expect(unknownUser).toBe(wrongPassword);
  });
});

describe('mapGenericError', () => {
  it('never echoes the underlying message', () => {
    const msg = mapGenericError({ code: 'internal', message: 'stack trace or db detail' });
    expect(msg).not.toContain('stack trace');
  });
});

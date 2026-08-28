import { describe, expect, it, vi } from 'vitest';
import { emailCodeFlowInitialState, emailCodeFlowReducer, type EmailCodeFlowState } from './useEmailCodeFlow';

// Only the pure reducer is under test here, but the module also imports
// '../api', which in turn imports the real '../firebase' (a real Firebase
// app init with no valid config in this test environment). Mock it out.
vi.mock('../api', () => ({
  requestLoginCode: vi.fn(),
  verifyLoginCode: vi.fn(),
}));
vi.mock('../firebase', () => ({
  toAppError: (err: unknown) => err,
}));

function state(overrides: Partial<EmailCodeFlowState> = {}): EmailCodeFlowState {
  return { ...emailCodeFlowInitialState, ...overrides };
}

describe('emailCodeFlowReducer (sign-in state machine)', () => {
  it('starts idle', () => {
    expect(emailCodeFlowInitialState).toEqual({ phase: 'idle', error: null, resendAvailableAt: null });
  });

  it('SEND_START moves to sending and clears any error', () => {
    const next = emailCodeFlowReducer(state({ error: 'old error' }), { type: 'SEND_START' });
    expect(next.phase).toBe('sending');
    expect(next.error).toBeNull();
  });

  it('SEND_DONE moves to sent with a resend cooldown timestamp', () => {
    const next = emailCodeFlowReducer(state({ phase: 'sending' }), {
      type: 'SEND_DONE',
      resendAvailableAt: 123,
    });
    expect(next).toEqual({ phase: 'sent', error: null, resendAvailableAt: 123 });
  });

  it('SEND_ERROR while sending falls back to idle with the error set', () => {
    const next = emailCodeFlowReducer(state({ phase: 'sending' }), {
      type: 'SEND_ERROR',
      message: 'Too many attempts. Please wait a few minutes and try again.',
    });
    expect(next.phase).toBe('idle');
    expect(next.error).toBe('Too many attempts. Please wait a few minutes and try again.');
  });

  it('SEND_ERROR after already sent keeps the sent phase (resend failed, code step stays up)', () => {
    const next = emailCodeFlowReducer(state({ phase: 'sent', resendAvailableAt: 999 }), {
      type: 'SEND_ERROR',
      message: 'boom',
    });
    expect(next.phase).toBe('sent');
    expect(next.error).toBe('boom');
  });

  it('VERIFY_START moves to verifying', () => {
    const next = emailCodeFlowReducer(state({ phase: 'sent' }), { type: 'VERIFY_START' });
    expect(next.phase).toBe('verifying');
  });

  it('VERIFY_ERROR returns to sent with the mapped error message', () => {
    const next = emailCodeFlowReducer(state({ phase: 'verifying', resendAvailableAt: 42 }), {
      type: 'VERIFY_ERROR',
      message: 'That code is not valid. Request a new one.',
    });
    expect(next.phase).toBe('sent');
    expect(next.error).toBe('That code is not valid. Request a new one.');
    // Resend cooldown is untouched by a failed verify.
    expect(next.resendAvailableAt).toBe(42);
  });

  it('RESET returns to the initial state', () => {
    const next = emailCodeFlowReducer(state({ phase: 'sent', error: 'x', resendAvailableAt: 1 }), {
      type: 'RESET',
    });
    expect(next).toEqual(emailCodeFlowInitialState);
  });
});

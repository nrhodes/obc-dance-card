/**
 * Encapsulates the "request a code, then verify it" flow so it can be reused
 * by both the Sign in screen and the inline re-authentication step in
 * Profile (setting a password requires a recent sign-in — plan §8.2).
 *
 * Deliberately has no opinion about what happens after a successful verify
 * (signing in vs. re-authenticating) — callers get the token back.
 */
import { useCallback, useReducer } from 'react';
import { requestLoginCode, verifyLoginCode } from '../api';
import { toAppError } from '../firebase';
import { mapCodeFlowError } from './errors';

export const RESEND_COOLDOWN_MS = 60_000;

export type EmailCodeFlowPhase = 'idle' | 'sending' | 'sent' | 'verifying';

export interface EmailCodeFlowState {
  phase: EmailCodeFlowPhase;
  error: string | null;
  /** epoch ms; resend is disabled until this passes. `null` = never sent. */
  resendAvailableAt: number | null;
}

type Action =
  | { type: 'SEND_START' }
  | { type: 'SEND_DONE'; resendAvailableAt: number }
  | { type: 'SEND_ERROR'; message: string }
  | { type: 'VERIFY_START' }
  | { type: 'VERIFY_ERROR'; message: string }
  | { type: 'RESET' };

const initialState: EmailCodeFlowState = { phase: 'idle', error: null, resendAvailableAt: null };

function reducer(state: EmailCodeFlowState, action: Action): EmailCodeFlowState {
  switch (action.type) {
    case 'SEND_START':
      return { ...state, phase: 'sending', error: null };
    case 'SEND_DONE':
      return { phase: 'sent', error: null, resendAvailableAt: action.resendAvailableAt };
    case 'SEND_ERROR':
      return { ...state, phase: state.phase === 'sending' ? 'idle' : state.phase, error: action.message };
    case 'VERIFY_START':
      return { ...state, phase: 'verifying', error: null };
    case 'VERIFY_ERROR':
      return { ...state, phase: 'sent', error: action.message };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

// Exported for direct unit testing of the state transitions.
export { reducer as emailCodeFlowReducer, initialState as emailCodeFlowInitialState };

export function useEmailCodeFlow() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const sendCode = useCallback(async (email: string): Promise<boolean> => {
    dispatch({ type: 'SEND_START' });
    try {
      await requestLoginCode({ email });
      dispatch({ type: 'SEND_DONE', resendAvailableAt: Date.now() + RESEND_COOLDOWN_MS });
      return true;
    } catch (err) {
      dispatch({ type: 'SEND_ERROR', message: mapCodeFlowError(toAppError(err)) });
      return false;
    }
  }, []);

  const verify = useCallback(async (email: string, code: string): Promise<string | null> => {
    dispatch({ type: 'VERIFY_START' });
    try {
      const { token } = await verifyLoginCode({ email, code });
      return token;
    } catch (err) {
      dispatch({ type: 'VERIFY_ERROR', message: mapCodeFlowError(toAppError(err)) });
      return null;
    }
  }, []);

  const reset = useCallback(() => dispatch({ type: 'RESET' }), []);

  return { state, sendCode, verify, reset };
}

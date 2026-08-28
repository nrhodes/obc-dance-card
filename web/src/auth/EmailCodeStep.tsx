/**
 * The "enter the 6-digit code" step, shared between the Sign in screen and
 * the inline re-authentication step in Profile (setting a password requires
 * a recent sign-in — plan §8.2). Sends the first code on mount.
 */
import { useEffect, useRef, useState } from 'react';
import { useEmailCodeFlow } from './useEmailCodeFlow';

export interface EmailCodeStepProps {
  email: string;
  /** Shown above the code input, e.g. "We've emailed a 6-digit code to …" */
  introText?: string;
  onVerified: (token: string) => void | Promise<void>;
  onUseDifferentEmail: () => void;
  useDifferentEmailLabel?: string;
}

export function EmailCodeStep({
  email,
  introText,
  onVerified,
  onUseDifferentEmail,
  useDifferentEmailLabel = 'Use a different email',
}: EmailCodeStepProps) {
  const { state, sendCode, verify } = useEmailCodeFlow();
  const [code, setCode] = useState('');
  const [now, setNow] = useState(Date.now());
  const sentOnce = useRef(false);

  useEffect(() => {
    if (sentOnce.current) return;
    sentOnce.current = true;
    void sendCode(email);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  useEffect(() => {
    if (!state.resendAvailableAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [state.resendAvailableAt]);

  const secondsRemaining =
    state.resendAvailableAt && state.resendAvailableAt > now
      ? Math.ceil((state.resendAvailableAt - now) / 1000)
      : 0;

  async function handleVerify() {
    const token = await verify(email, code);
    if (token) {
      await onVerified(token);
    }
  }

  function handleCodeChange(value: string) {
    // Accept paste of a 6-digit code (may include spaces).
    const digitsOnly = value.replace(/\D/g, '').slice(0, 6);
    setCode(digitsOnly);
  }

  const canSubmit = code.length === 6 && state.phase !== 'verifying' && state.phase !== 'sending';

  return (
    <div className="stack">
      <p>
        {introText ?? `We've emailed a 6-digit code to ${email}. It's valid for 10 minutes.`}
      </p>
      {state.error && (
        <div className="alert alert-error" role="alert">
          {state.error}
        </div>
      )}
      <div className="field">
        <label htmlFor="login-code">6-digit code</label>
        <input
          id="login-code"
          className="code-input"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          value={code}
          onChange={(e) => handleCodeChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) void handleVerify();
          }}
        />
      </div>
      <button
        type="button"
        className="button button-primary"
        disabled={!canSubmit}
        onClick={() => void handleVerify()}
      >
        {state.phase === 'verifying' ? 'Signing in…' : 'Sign in'}
      </button>
      <button
        type="button"
        className="button-link"
        disabled={secondsRemaining > 0 || state.phase === 'sending'}
        onClick={() => void sendCode(email)}
      >
        {secondsRemaining > 0 ? `Send a new code (${secondsRemaining}s)` : 'Send a new code'}
      </button>
      <button type="button" className="button-link" onClick={onUseDifferentEmail}>
        {useDifferentEmailLabel}
      </button>
    </div>
  );
}

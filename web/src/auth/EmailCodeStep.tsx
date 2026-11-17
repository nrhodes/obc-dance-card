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
  /** The verify button's label — "Sign in" for the sign-in flow; e.g. "Confirm" when re-authenticating inline (set-password, audit M1). */
  verifyLabel?: string;
  /** The verify button's in-progress label, paired with `verifyLabel`. */
  verifyingLabel?: string;
}

export function EmailCodeStep({
  email,
  introText,
  onVerified,
  onUseDifferentEmail,
  useDifferentEmailLabel = 'Use a different email',
  verifyLabel = 'Sign in',
  verifyingLabel = 'Signing in…',
}: EmailCodeStepProps) {
  const { state, sendCode, verify } = useEmailCodeFlow();
  const [code, setCode] = useState('');
  // Set when the code verified but what follows (redeeming the token with
  // Firebase Auth, in the sign-in flow) threw. Without this the rejection
  // was unhandled and the screen just sat there (incident 2026-11-17).
  const [afterVerifyError, setAfterVerifyError] = useState<string | null>(null);
  // Lazy initializer: `useState(Date.now())` would re-evaluate Date.now() on
  // every render (react-hooks 7 `purity` rule catch on the 5.2->7.1 upgrade).
  const [now, setNow] = useState(() => Date.now());
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
    setAfterVerifyError(null);
    const token = await verify(email, code);
    if (token) {
      try {
        await onVerified(token);
      } catch {
        setAfterVerifyError(
          'Your code was right, but signing in didn’t finish. If you use an ad or privacy blocker, allow this site and try again.',
        );
      }
    }
  }

  // Never claim an email went out before the request succeeded: the first
  // send can be refused (rate limit, outage) and the old unconditional
  // "We've emailed…" line then lied next to the error (incident 2026-11-17).
  const sentAtLeastOnce = state.phase === 'sent' || state.phase === 'verifying' || state.resendAvailableAt !== null;
  const intro = sentAtLeastOnce
    ? (introText ?? `We've emailed a 6-digit code to ${email}. It's valid for 10 minutes.`)
    : state.phase === 'sending'
      ? `Sending a 6-digit code to ${email}…`
      : `We couldn't send a code to ${email}.`;
  const error = state.error ?? afterVerifyError;

  function handleCodeChange(value: string) {
    // Accept paste of a 6-digit code (may include spaces).
    const digitsOnly = value.replace(/\D/g, '').slice(0, 6);
    setCode(digitsOnly);
  }

  const canSubmit = code.length === 6 && state.phase !== 'verifying' && state.phase !== 'sending';

  return (
    <div className="stack">
      <p>{intro}</p>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
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
        {state.phase === 'verifying' ? verifyingLabel : verifyLabel}
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

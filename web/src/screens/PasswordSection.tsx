/**
 * Set / remove password (plan §8.2, §9.2). Setting a password calls the
 * server-side `setPassword` callable, which requires the member to have
 * signed in recently (audit M1). Unlike Firebase's own client-side
 * `updatePassword`/`requires-recent-login` mechanism, the member is NEVER
 * navigated away to a sign-in screen to satisfy that: when the server
 * rejects with `details.reason === RECENT_LOGIN_REQUIRED_REASON`, this
 * component stays on the same section, keeps the password the member
 * already typed, and runs the emailed-code flow inline (reusing
 * `EmailCodeStep`) — then automatically retries `setPassword` once the
 * member verifies the code. Removing a password rotates it to an
 * unknowable value server-side without ending the session (risk-reducing,
 * so no freshness check).
 */
import { useState } from 'react';
import { passwordStrengthError, RECENT_LOGIN_REQUIRED_REASON } from '@obc/shared';
import { signInWithCustomToken } from 'firebase/auth';
import { auth, toAppError, type AppError } from '../firebase';
import { setPassword, removePassword } from '../api';
import { mapGenericError } from '../auth/errors';
import { EmailCodeStep } from '../auth/EmailCodeStep';

export interface PasswordSectionProps {
  hasPassword: boolean;
  email: string;
}

export function PasswordSection({ hasPassword, email }: PasswordSectionProps) {
  if (hasPassword) {
    return <RemovePassword email={email} />;
  }
  return <SetPassword email={email} />;
}

/** True when `details` is the shape `setPassword` sends for a stale session. */
function isRecentLoginRequired(err: AppError): boolean {
  return (
    err.code === 'failed-precondition' &&
    typeof err.details === 'object' &&
    err.details !== null &&
    (err.details as { reason?: unknown }).reason === RECENT_LOGIN_REQUIRED_REASON
  );
}

function SetPassword({ email }: { email: string }) {
  const [password, setPassword_] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Inline re-auth step (audit M1): shown instead of the form, never a
  // navigation. `password`/`confirm` above are untouched while this is up.
  const [needsReauth, setNeedsReauth] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSuccess(false);
    const strengthError = passwordStrengthError(password);
    if (strengthError) {
      setError(strengthError);
      return;
    }
    if (password !== confirm) {
      setError('Those passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await setPassword({ password });
      setSuccess(true);
      setPassword_('');
      setConfirm('');
    } catch (err) {
      const appErr = toAppError(err);
      if (isRecentLoginRequired(appErr)) {
        setNeedsReauth(true);
      } else {
        setError(mapGenericError(appErr));
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Called once the inline code step verifies. Signing in with the fresh
  // custom token gives the session a fresh `auth_time`, so the retry below
  // clears the server's recent-login check.
  async function handleReauthVerified(token: string) {
    setSubmitting(true);
    setError(null);
    try {
      await signInWithCustomToken(auth, token);
      await setPassword({ password });
      setNeedsReauth(false);
      setSuccess(true);
      setPassword_('');
      setConfirm('');
    } catch (err) {
      // Whatever went wrong here isn't the "please re-auth" case again (we
      // just did that) — surface it as a normal error back on the form
      // rather than looping on the code step.
      setNeedsReauth(false);
      setError(mapGenericError(toAppError(err)));
    } finally {
      setSubmitting(false);
    }
  }

  if (needsReauth) {
    return (
      <div>
        <h2>Set a password (optional)</h2>
        <p role="status" aria-live="polite">
          To keep your account safe, we&apos;ve emailed you a 6-digit code. Enter it here to finish setting your
          password.
        </p>
        <EmailCodeStep
          email={email}
          introText={`We've emailed a 6-digit code to ${email}. It's valid for 10 minutes.`}
          onVerified={handleReauthVerified}
          onUseDifferentEmail={() => setNeedsReauth(false)}
          useDifferentEmailLabel="Cancel"
          verifyLabel="Confirm"
          verifyingLabel="Confirming…"
        />
      </div>
    );
  }

  return (
    <div>
      <h2>Set a password (optional)</h2>
      <p className="muted">
        You can always sign in with an emailed code. A password is optional and just saves you a step.
      </p>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className="alert alert-success" role="status">
          Password set.
        </div>
      )}
      <div className="field">
        <label htmlFor="new-password">New password</label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword_(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="confirm-password">Confirm password</label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      <button
        type="button"
        className="button button-primary"
        disabled={submitting}
        onClick={() => void handleSubmit()}
      >
        {submitting ? 'Saving…' : 'Set password'}
      </button>
    </div>
  );
}

function RemovePassword({ email }: { email: string }) {
  void email;
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      await removePassword({});
      setDone(true);
    } catch (err) {
      setError(mapGenericError(toAppError(err)));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div>
        <h2>Password removed</h2>
        <p>You will need to sign in with an emailed code next time.</p>
      </div>
    );
  }

  return (
    <div>
      <h2>Password</h2>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {!confirming ? (
        <button type="button" className="button button-secondary" onClick={() => setConfirming(true)}>
          Remove password
        </button>
      ) : (
        <div className="stack">
          <p>
            Are you sure? You will need to sign in with an emailed code next time instead of a password.
          </p>
          <div className="actions-row">
            <button
              type="button"
              className="button button-danger"
              disabled={submitting}
              onClick={() => void handleConfirm()}
            >
              {submitting ? 'Removing…' : 'Yes, remove my password'}
            </button>
            <button type="button" className="button button-secondary" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

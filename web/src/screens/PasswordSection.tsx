/**
 * Set / remove password (plan §8.2, §9.2 `markPasswordSet` / `removePassword`).
 *
 * Setting a password requires a "recently signed in" ID token; when Firebase
 * rejects `updatePassword` with `auth/requires-recent-login` we run the
 * emailed-code flow inline (reusing `EmailCodeStep`) and retry automatically
 * once it succeeds.
 */
import { useState } from 'react';
import { signInWithCustomToken, updatePassword } from 'firebase/auth';
import { auth, toAppError } from '../firebase';
import { markPasswordSet, removePassword } from '../api';
import { mapGenericError } from '../auth/errors';
import { validatePasswordStrength } from '../auth/passwordStrength';
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

function SetPassword({ email }: { email: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);

  async function attemptSetPassword(pw: string) {
    await updatePassword(auth.currentUser!, pw);
    await markPasswordSet({});
  }

  async function handleSubmit() {
    setError(null);
    setSuccess(false);
    const strengthError = validatePasswordStrength(password);
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
      await attemptSetPassword(password);
      setSuccess(true);
      setPassword('');
      setConfirm('');
    } catch (err) {
      const appErr = toAppError(err);
      if (appErr.code === 'auth/requires-recent-login') {
        setNeedsReauth(true);
      } else {
        setError(mapGenericError(appErr));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReauthVerified(token: string) {
    await signInWithCustomToken(auth, token);
    setNeedsReauth(false);
    setSubmitting(true);
    setError(null);
    try {
      await attemptSetPassword(password);
      setSuccess(true);
      setPassword('');
      setConfirm('');
    } catch (err) {
      setError(mapGenericError(toAppError(err)));
    } finally {
      setSubmitting(false);
    }
  }

  if (needsReauth) {
    return (
      <div>
        <h2>Set a password</h2>
        <p>For your security, please sign in again first.</p>
        <EmailCodeStep
          email={email}
          onVerified={handleReauthVerified}
          onUseDifferentEmail={() => setNeedsReauth(false)}
          useDifferentEmailLabel="Cancel"
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
          onChange={(e) => setPassword(e.target.value)}
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
        disabled={submitting || password.length === 0}
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

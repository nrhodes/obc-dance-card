/**
 * Set / remove password (plan §8.2, §9.2). Setting a password calls the
 * server-side `setPassword` callable, which uses the member's current session
 * — no Firebase "recent login" re-auth, so the member is never bounced to a
 * sign-in screen just to add an optional password. Removing rotates the
 * password to an unknowable value server-side without ending the session.
 */
import { useState } from 'react';
import { passwordStrengthError } from '@obc/shared';
import { toAppError } from '../firebase';
import { setPassword, removePassword } from '../api';
import { mapGenericError } from '../auth/errors';

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
  void email;
  const [password, setPassword_] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
      // Server-side: uses the current session, so there is no "sign in again"
      // detour (plan §8.2 / accessibility for elderly members).
      await setPassword({ password });
      setSuccess(true);
      setPassword_('');
      setConfirm('');
    } catch (err) {
      setError(mapGenericError(toAppError(err)));
    } finally {
      setSubmitting(false);
    }
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

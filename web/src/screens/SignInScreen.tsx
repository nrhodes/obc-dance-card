/**
 * Sign in (plan §8.2, §14.1). Two paths, both starting from one email field:
 *   - "Email me a code" (primary) -> `EmailCodeStep` -> `signInWithCustomToken`
 *   - "I have a password" (secondary) reveals an inline password field ->
 *     `signInWithEmailAndPassword`
 *
 * Never renders a link that suggests clicking a link in an email — the code
 * copy always says "type this code", never "click".
 */
import { useState } from 'react';
import { signInWithCustomToken, signInWithEmailAndPassword } from 'firebase/auth';
import { auth, toAppError } from '../firebase';
import { EmailCodeStep } from '../auth/EmailCodeStep';
import { mapPasswordSignInError } from '../auth/errors';

type Step = 'chooser' | 'code';

export function SignInScreen() {
  const [step, setStep] = useState<Step>('chooser');
  const [email, setEmail] = useState('');
  const [showPasswordField, setShowPasswordField] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);

  const emailValid = /^\S+@\S+\.\S+$/.test(email.trim());

  function handleRequestCode() {
    if (!emailValid) return;
    setStep('code');
  }

  async function handlePasswordSignIn() {
    if (!emailValid || password.length === 0) return;
    setPasswordSubmitting(true);
    setPasswordError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      // AuthProvider picks up the new user; RedirectIfSignedIn on /signin
      // takes it from there.
    } catch (err) {
      setPasswordError(mapPasswordSignInError(toAppError(err)));
    } finally {
      setPasswordSubmitting(false);
    }
  }

  async function handleVerified(token: string) {
    await signInWithCustomToken(auth, token);
  }

  if (step === 'code') {
    return (
      <div className="card">
        <h1>Enter your code</h1>
        <EmailCodeStep
          email={email.trim().toLowerCase()}
          onVerified={handleVerified}
          onUseDifferentEmail={() => setStep('chooser')}
        />
      </div>
    );
  }

  return (
    <div className="card">
      <h1>Sign in</h1>
      <div className="field">
        <label htmlFor="signin-email">Email address</label>
        <input
          id="signin-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="stack">
        <button
          type="button"
          className="button button-primary"
          disabled={!emailValid}
          onClick={handleRequestCode}
        >
          Email me a code
        </button>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => setShowPasswordField((v) => !v)}
        >
          I have a password
        </button>
      </div>

      {showPasswordField && (
        <div className="stack" style={{ marginTop: 'var(--space-2)' }}>
          {passwordError && (
            <div className="alert alert-error" role="alert">
              {passwordError}
            </div>
          )}
          <div className="field">
            <label htmlFor="signin-password">Password</label>
            <input
              id="signin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handlePasswordSignIn();
              }}
            />
          </div>
          <button
            type="button"
            className="button button-primary"
            disabled={!emailValid || password.length === 0 || passwordSubmitting}
            onClick={() => void handlePasswordSignIn()}
          >
            {passwordSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      )}
    </div>
  );
}

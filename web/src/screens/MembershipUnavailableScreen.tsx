import { useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { resetSiteDataAndReload } from '../auth/resetSiteData';

/**
 * Shown when the member is signed in but their member record could not be
 * loaded for a reason that is NOT "this membership is not active" — App
 * Check could not verify the browser, or the service could not be reached.
 * Never renders member data (same rule as `NotActiveScreen`).
 */
export function MembershipUnavailableScreen({
  problem,
}: {
  problem: 'browser-not-verified' | 'unavailable' | 'blocked';
}) {
  const { signOut } = useAuth();
  const [resetting, setResetting] = useState(false);

  return (
    <main id="content">
      <div className="card">
        <h1>We couldn’t load your details</h1>
        {problem === 'browser-not-verified' ? (
          <p>
            You are signed in, but this browser couldn’t be verified with the club’s system, so your dance card can’t be
            shown. This is a problem with this browser, not a sign that your membership has lapsed, and it is usually
            temporary.
          </p>
        ) : problem === 'blocked' ? (
          <>
            <p>
              You are signed in, but something in this browser is blocking the club’s system. That is usually an ad or
              privacy blocker, or a filter on a work network — this site reaches Google’s servers (googleapis.com) to
              load your dance card.
            </p>
            <p>
              Allow <strong>{window.location.host}</strong> in your blocker (or turn it off for this site) and try
              again. A private window, where extensions are off, is a quick way to check.
            </p>
          </>
        ) : (
          <>
            <p>You are signed in, but the club’s system couldn’t be reached. Check your connection and try again.</p>
            <p className="muted">If you use an ad or privacy blocker, make sure it allows this site.</p>
          </>
        )}
        <p>
          <button type="button" className="button button-primary" onClick={() => window.location.reload()}>
            Try again
          </button>
        </p>
        <p>
          If that doesn’t help, reset this browser. It clears what this site has saved here (nothing else), and you
          will need to sign in again.
        </p>
        <p>
          <button
            type="button"
            className="button button-secondary"
            disabled={resetting}
            onClick={() => {
              setResetting(true);
              void resetSiteDataAndReload();
            }}
          >
            {resetting ? 'Resetting…' : 'Reset this browser and sign in again'}
          </button>
        </p>
        <p>
          <button type="button" className="button button-secondary" onClick={() => void signOut()}>
            Sign out
          </button>
        </p>
        <p className="muted">Still stuck? Try a private window, or contact the club.</p>
      </div>
    </main>
  );
}

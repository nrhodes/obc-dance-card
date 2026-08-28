import { useAuth } from '../auth/useAuth';

/**
 * Shown when the signed-in Auth user has no active member doc (deactivated,
 * or never provisioned). Never renders member data here (plan spec:
 * "Never render member data in that state").
 */
export function NotActiveScreen() {
  const { signOut } = useAuth();

  return (
    <main id="content">
      <div className="card">
        <h1>Your membership is not active</h1>
        <p>Please contact the club if you think this is a mistake.</p>
        <button type="button" className="button button-primary" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </main>
  );
}

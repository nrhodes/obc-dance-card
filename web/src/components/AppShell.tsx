import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { useInvites } from '../invites/useInvites';
import { useNotifications } from '../notifications/useNotifications';
import { useActingAs } from '../admin/useActingAs';
import { usePushForeground } from '../push/usePushForeground';
import { usePwaUpdate } from '../pwa/usePwaUpdate';
import { useIdleSignOut } from '../session/useIdleSignOut';
import { OfflineBanner } from './OfflineBanner';

export function AppShell() {
  const { member, signOut } = useAuth();
  const { incoming } = useInvites();
  const { unreadCount } = useNotifications();
  const { actingAs, stopActingAs } = useActingAs();
  const { toast, dismissToast } = usePushForeground();
  const { needsRefresh, reload } = usePwaUpdate();
  const isAdmin = member?.role === 'admin';

  // Shared-device safety (plan §8.1): sign out on next load after 30 days of
  // no activity on this device (task deliverable C).
  useIdleSignOut(signOut);

  return (
    <>
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <header className="app-header">
        <div className="app-header-top">
          <p className="title">Orewa Bridge Club</p>
          {member && (
            <button
              type="button"
              className="button-link not-you-link"
              onClick={() => void signOut()}
            >
              Not you? Sign out
            </button>
          )}
        </div>
        <nav className="app-nav" aria-label="Main">
          <NavLink to="/" end>
            My card
          </NavLink>
          <NavLink to="/programme">Programme</NavLink>
          <NavLink to="/invites">
            Invites
            {incoming.length > 0 && <span className="nav-badge">{incoming.length}</span>}
          </NavLink>
          <NavLink to="/notifications">
            Notifications
            {unreadCount > 0 && <span className="nav-badge">{unreadCount}</span>}
          </NavLink>
          <NavLink to="/profile">Profile</NavLink>
          <NavLink to="/help">Help</NavLink>
          {isAdmin && <NavLink to="/admin/members">Admin: Members</NavLink>}
          {isAdmin && <NavLink to="/admin/programme">Admin: Programme</NavLink>}
          {isAdmin && <NavLink to="/admin/broadcast">Admin: Broadcast</NavLink>}
          {isAdmin && <NavLink to="/admin/audit">Admin: Audit log</NavLink>}
          {isAdmin && <NavLink to="/admin/integrity">Admin: Integrity</NavLink>}
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </nav>
      </header>
      {actingAs && (
        <div className="alert alert-error acting-as-banner" role="status">
          Acting on behalf of <strong>{actingAs.name}</strong>
          {' — '}
          <button type="button" className="button button-link" onClick={stopActingAs}>
            Stop
          </button>
        </div>
      )}
      <OfflineBanner />
      {needsRefresh && (
        <div className="alert alert-info" role="status">
          A new version is ready.{' '}
          <button type="button" className="button button-secondary" onClick={reload}>
            Reload
          </button>
        </div>
      )}
      {toast && (
        <div className="alert alert-info" role="status">
          {toast}{' '}
          <button type="button" className="button button-secondary" onClick={dismissToast}>
            Dismiss
          </button>
        </div>
      )}
      <main id="content">
        <Outlet />
      </main>
    </>
  );
}

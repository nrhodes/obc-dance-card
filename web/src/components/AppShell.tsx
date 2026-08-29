import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { useInvites } from '../invites/useInvites';
import { useNotifications } from '../notifications/useNotifications';
import { useActingAs } from '../admin/useActingAs';

export function AppShell() {
  const { member, signOut } = useAuth();
  const { incoming } = useInvites();
  const { unreadCount } = useNotifications();
  const { actingAs, stopActingAs } = useActingAs();
  const isAdmin = member?.role === 'admin';

  return (
    <>
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <header className="app-header">
        <p className="title">Orewa Bridge Club</p>
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
      <main id="content">
        <Outlet />
      </main>
    </>
  );
}

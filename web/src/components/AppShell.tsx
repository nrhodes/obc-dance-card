import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { useInvites } from '../invites/useInvites';
import { useNotifications } from '../notifications/useNotifications';

export function AppShell() {
  const { member, signOut } = useAuth();
  const { incoming } = useInvites();
  const { unreadCount } = useNotifications();
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
          {isAdmin && <NavLink to="/admin/programme">Admin: Programme import</NavLink>}
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </nav>
      </header>
      <main id="content">
        <Outlet />
      </main>
    </>
  );
}

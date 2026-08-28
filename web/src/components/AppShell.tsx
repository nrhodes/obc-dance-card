import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';

export function AppShell() {
  const { member, signOut } = useAuth();
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
            Home
          </NavLink>
          <NavLink to="/profile">Profile</NavLink>
          {isAdmin && <NavLink to="/admin/members">Admin</NavLink>}
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

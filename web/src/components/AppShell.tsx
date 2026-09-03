import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
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
  const [adminOpen, setAdminOpen] = useState(false);
  const adminMenuRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();

  // The admin links live in a disclosure so the always-visible member nav
  // stays one row (plan §14.1 keeps *member* destinations un-hidden; admins
  // are comfortable with a menu). Close it on navigation, Escape, or an
  // outside click/focus.
  useEffect(() => {
    setAdminOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!adminOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAdminOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (adminMenuRef.current && !adminMenuRef.current.contains(e.target as Node)) setAdminOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [adminOpen]);

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
          <NavLink to="/calendar">Calendar</NavLink>
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
          {isAdmin && (
            <div className="admin-menu" ref={adminMenuRef}>
              <button
                type="button"
                aria-expanded={adminOpen}
                aria-haspopup="true"
                className={location.pathname.startsWith('/admin') ? 'active' : undefined}
                onClick={() => setAdminOpen((o) => !o)}
              >
                Admin <span aria-hidden="true">{adminOpen ? '▴' : '▾'}</span>
              </button>
              {adminOpen && (
                <div className="admin-menu-list">
                  <NavLink to="/admin/members">Members</NavLink>
                  <NavLink to="/admin/programme">Programme</NavLink>
                  <NavLink to="/admin/broadcast">Broadcast</NavLink>
                  <NavLink to="/admin/audit">Audit log</NavLink>
                  <NavLink to="/admin/integrity">Integrity</NavLink>
                </div>
              )}
            </div>
          )}
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

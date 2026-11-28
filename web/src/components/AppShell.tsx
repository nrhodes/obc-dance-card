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
import { isWideRoute } from './wideRoute';
import { PRODUCT_NAME } from '@obc/shared';
import { useClubs } from '../club/useClub';
import { usePlatformAdmin } from '../platform/usePlatformAdmin';

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
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();

  // The admin links live in a disclosure so the always-visible member nav
  // stays one row (plan §14.1 keeps *member* destinations un-hidden; admins
  // are comfortable with a menu). Close it on navigation, Escape, or an
  // outside click/focus.
  useEffect(() => {
    setAdminOpen(false);
    setMoreOpen(false);
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

  // "More" is the same disclosure pattern as Admin's, just for Profile/Help/
  // Sign out (2026-09-06 UI review: ~10 flat nav items wrapped to 4 rows at
  // 420px). Kept as a second, independent disclosure rather than merged
  // with Admin's — Admin is admin-only and already means something specific
  // to members who see it.
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [moreOpen]);

  // Shared-device safety (plan §8.1): sign out on next load after 30 days of
  // no activity on this device (task deliverable C).
  useIdleSignOut(signOut);

  // Clubs (plan §21 B14): a person in one club sees only its name; a person
  // in several also gets a switcher. Each screen shows one club at a time.
  const { clubs, currentClubId, selectClub } = useClubs();
  const { isPlatformAdmin } = usePlatformAdmin();
  const currentClubName = clubs.find((c) => c.id === currentClubId)?.name;

  // The tab's title names the club being shown, then the product.
  useEffect(() => {
    document.title = currentClubName ? `${currentClubName} — ${PRODUCT_NAME}` : PRODUCT_NAME;
    return () => {
      document.title = PRODUCT_NAME;
    };
  }, [currentClubName]);

  return (
    <>
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <header className="app-header">
        <div className="app-header-top">
          <p className="title">{currentClubName ?? PRODUCT_NAME}</p>
          {clubs.length > 1 && (
            <select
              className="club-switcher"
              aria-label="Club"
              value={currentClubId}
              onChange={(e) => selectClub(e.target.value)}
            >
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
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
          <NavLink to="/members">Members</NavLink>
          <div className="more-menu" ref={moreMenuRef}>
            <button
              type="button"
              aria-expanded={moreOpen}
              aria-haspopup="true"
              className={['/profile', '/help'].some((p) => location.pathname.startsWith(p)) ? 'active' : undefined}
              onClick={() => setMoreOpen((o) => !o)}
            >
              More <span aria-hidden="true">{moreOpen ? '▴' : '▾'}</span>
            </button>
            {moreOpen && (
              <div className="more-menu-list">
                <NavLink to="/profile">Profile</NavLink>
                <NavLink to="/help">Help</NavLink>
                {/* Platform administrators only (plan §21 B14.3): clubs and
                    who administers them. Not under "Admin", which means
                    admin of the club being shown. */}
                {isPlatformAdmin && <NavLink to="/platform">Platform</NavLink>}
                {/* Sign out lives here now, not as a separate header link —
                    plan §8.1's "sign out should be prominent" is satisfied
                    by this disclosure being one tap away from any screen,
                    same as the old header link was. The former "Not you?
                    Sign out" header link is gone; this button reuses the
                    same signOut() handler. */}
                <button type="button" onClick={() => void signOut()}>
                  Sign out
                </button>
              </div>
            )}
          </div>
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
      <main id="content" className={isWideRoute(location.pathname) ? 'main-wide' : undefined}>
        <Outlet />
      </main>
    </>
  );
}

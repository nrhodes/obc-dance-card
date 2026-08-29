/**
 * Admin: Members table (plan §9.2 `setMemberRole`/`deactivateMember`/
 * `reactivateMember`/`eraseMember`, §16 Phase 6, Phase 6b task deliverable 2).
 * Admins may read every member doc, active or not (rules §10) — this
 * subscribes to the whole `members` collection, unlike
 * `MembersDirectoryProvider` (active-only, member-facing).
 */
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { paths, type Member, type MemberRole } from '@obc/shared';
import { db } from '../../firebase';
import type { AppError } from '../../firebase';
import { deactivateMember, eraseMember, reactivateMember, setMemberRole } from '../../api';
import { mapAdminActionError } from '../../admin/adminErrors';
import { useActingAs } from '../../admin/useActingAs';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Dialog } from '../../components/Dialog';
import { SubscriptionError } from '../../components/SubscriptionError';

type ActiveFilter = 'all' | 'active' | 'inactive';
type RoleFilter = 'all' | 'admin';

function fullName(m: Member): string {
  return `${m.firstName} ${m.lastName}`.trim();
}

type RowDialog =
  | { kind: 'role'; member: Member; nextRole: MemberRole }
  | { kind: 'deactivate'; member: Member }
  | { kind: 'reactivate'; member: Member }
  | { kind: 'erase'; member: Member };

export function MembersTable() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [subError, setSubError] = useState<{ code: string } | null>(null);
  const { actingAs, startActingAs } = useActingAs();

  useEffect(() => {
    return onSnapshot(
      collection(db, paths.members()),
      (snap) => {
        setMembers(snap.docs.map((d) => d.data() as Member));
        setSubError(null);
        setLoading(false);
      },
      (err) => {
        console.error('subscription_failed', 'admin_members', err.code);
        setMembers([]);
        setSubError({ code: err.code });
        setLoading(false);
      },
    );
  }, []);

  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [dialog, setDialog] = useState<RowDialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members
      .filter((m) => (activeFilter === 'active' ? m.active : activeFilter === 'inactive' ? !m.active : true))
      .filter((m) => (roleFilter === 'admin' ? m.role === 'admin' : true))
      .filter((m) => (q ? fullName(m).toLowerCase().includes(q) : true))
      .sort((a, b) => fullName(a).localeCompare(fullName(b)));
  }, [members, search, activeFilter, roleFilter]);

  function closeDialog() {
    setDialog(null);
    setError(null);
  }

  async function run(action: () => Promise<void>, successMessage: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setDialog(null);
      setNotice(successMessage);
    } catch (err) {
      setError(mapAdminActionError(err as AppError));
    } finally {
      setBusy(false);
    }
  }

  function handleActAs(member: Member) {
    startActingAs({ memberId: member.id, name: fullName(member) });
    setNotice(`Now acting on behalf of ${fullName(member)}. Use the banner above to stop.`);
  }

  return (
    <div className="stack">
      {subError && <SubscriptionError resource="members" />}
      {notice && (
        <div className="card alert-success" role="status">
          {notice}
        </div>
      )}

      <div className="card">
        <div className="field">
          <label htmlFor="members-search">Search by name</label>
          <input
            id="members-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members"
          />
        </div>
        <div className="actions-row">
          <label>
            Status{' '}
            <select
              aria-label="Filter by status"
              value={activeFilter}
              onChange={(e) => setActiveFilter(e.target.value as ActiveFilter)}
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label>
            Role{' '}
            <select aria-label="Filter by role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}>
              <option value="all">All</option>
              <option value="admin">Admins only</option>
            </select>
          </label>
        </div>
      </div>

      <div className="card">
        {loading && <p>Loading…</p>}
        {!loading && filtered.length === 0 && <p className="muted">No members match.</p>}
        {!loading && filtered.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Grade</th>
                  <th>Phone</th>
                  <th>Role</th>
                  <th>Active</th>
                  <th>Last import</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {fullName(m)}
                      {actingAs?.memberId === m.id && <span className="badge">Acting as</span>}
                    </td>
                    <td>{m.grade}</td>
                    <td>{m.phone || '—'}</td>
                    <td>{m.role}</td>
                    <td>{m.active ? 'Yes' : 'No'}</td>
                    <td>{m.lastImportId ?? '—'}</td>
                    <td>
                      <div className="actions-row">
                        <button
                          type="button"
                          className="button button-link"
                          onClick={() =>
                            setDialog({ kind: 'role', member: m, nextRole: m.role === 'admin' ? 'member' : 'admin' })
                          }
                        >
                          {m.role === 'admin' ? 'Remove admin' : 'Make admin'}
                        </button>
                        {m.active ? (
                          <button
                            type="button"
                            className="button button-link"
                            onClick={() => setDialog({ kind: 'deactivate', member: m })}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="button button-link"
                              onClick={() => setDialog({ kind: 'reactivate', member: m })}
                            >
                              Reactivate
                            </button>
                            <button
                              type="button"
                              className="button button-link"
                              onClick={() => setDialog({ kind: 'erase', member: m })}
                            >
                              Erase
                            </button>
                          </>
                        )}
                        {m.active && (
                          <button type="button" className="button button-link" onClick={() => handleActAs(m)}>
                            Act on behalf
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dialog?.kind === 'role' && (
        <ConfirmDialog
          title={dialog.nextRole === 'admin' ? 'Make this member an admin?' : 'Remove admin access?'}
          body={
            dialog.nextRole === 'admin'
              ? `${fullName(dialog.member)} will be able to manage members, the programme, and other admin actions.`
              : `${fullName(dialog.member)} will lose admin access.`
          }
          confirmLabel={dialog.nextRole === 'admin' ? 'Make admin' : 'Remove admin'}
          danger={dialog.nextRole === 'member'}
          busy={busy}
          error={error}
          onClose={closeDialog}
          onConfirm={() =>
            void run(async () => {
              await setMemberRole({ memberId: dialog.member.id, role: dialog.nextRole });
            }, dialog.nextRole === 'admin' ? `${fullName(dialog.member)} is now an admin.` : `${fullName(dialog.member)} is no longer an admin.`)
          }
        />
      )}

      {dialog?.kind === 'deactivate' && <DeactivateDialog member={dialog.member} busy={busy} error={error} onClose={closeDialog} onRun={run} />}

      {dialog?.kind === 'reactivate' && (
        <ConfirmDialog
          title="Reactivate this member?"
          body={`${fullName(dialog.member)} will be able to sign in again.`}
          confirmLabel="Reactivate"
          busy={busy}
          error={error}
          onClose={closeDialog}
          onConfirm={() =>
            void run(async () => {
              await reactivateMember({ memberId: dialog.member.id });
            }, `${fullName(dialog.member)} has been reactivated.`)
          }
        />
      )}

      {dialog?.kind === 'erase' && <EraseDialog member={dialog.member} busy={busy} error={error} onClose={closeDialog} onRun={run} />}
    </div>
  );
}

function DeactivateDialog({
  member,
  busy,
  error,
  onClose,
  onRun,
}: {
  member: Member;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onRun: (action: () => Promise<void>, successMessage: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Dialog title="Deactivate this member?" onClose={onClose}>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <p>
        {fullName(member)} will no longer be able to sign in. Their future pairings will be cancelled, partners
        notified, pending invites expired, and any team they belong to updated.
      </p>
      <div className="field">
        <label htmlFor="deactivate-reason">Reason (optional)</label>
        <textarea id="deactivate-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="actions-row">
        <button
          type="button"
          className="button button-danger"
          disabled={busy}
          onClick={() =>
            onRun(async () => {
              await deactivateMember({ memberId: member.id, ...(reason.trim() ? { reason: reason.trim() } : {}) });
            }, `${fullName(member)} has been deactivated.`)
          }
        >
          {busy ? 'Working…' : 'Deactivate'}
        </button>
        <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

function EraseDialog({
  member,
  busy,
  error,
  onClose,
  onRun,
}: {
  member: Member;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onRun: (action: () => Promise<void>, successMessage: string) => void;
}) {
  const [confirmName, setConfirmName] = useState('');
  const expected = fullName(member);
  const canErase = confirmName === expected && !busy;
  return (
    <Dialog title="Erase this member?" onClose={onClose}>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <p>
        This permanently scrubs {expected}&apos;s personal details (name, phone, email), deletes their visitors, and
        removes their Auth account. Entries are kept, anonymised. Members must be deactivated for at least 30 days
        before they can be erased.
      </p>
      <div className="field">
        <label htmlFor="erase-confirm-name">
          Type the member&apos;s full name (<strong>{expected}</strong>) to confirm
        </label>
        <input id="erase-confirm-name" type="text" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
      </div>
      <div className="actions-row">
        <button
          type="button"
          className="button button-danger"
          disabled={!canErase}
          onClick={() =>
            onRun(async () => {
              await eraseMember({ memberId: member.id, confirmName });
            }, `${expected} has been erased.`)
          }
        >
          {busy ? 'Working…' : 'Erase permanently'}
        </button>
        <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

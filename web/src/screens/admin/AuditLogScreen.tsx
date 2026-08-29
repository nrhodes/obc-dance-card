/**
 * Admin: Audit log (`listAuditLog`, plan §9.2, §10 note, Phase 6b task
 * deliverable 5). `auditLog` is server-only (rules deny every client read of
 * it, plan §10) — this callable is the *only* way to see it, paged 50 at a
 * time via `nextBefore`. `detail`/`before`/`after` are rendered as plain
 * text inside `<pre>` — never `dangerouslySetInnerHTML` (plan §14.1) — so an
 * audited value can never execute as markup.
 */
import { Fragment, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AUDIT_ACTIONS, isOneOf, type AuditAction, type AuditLogEntry } from '@obc/shared';
import type { AppError } from '../../firebase';
import { listAuditLog } from '../../api';
import { mapAdminActionError } from '../../admin/adminErrors';
import { useMembersDirectory } from '../../members/useMembersDirectory';
import { formatDateTimeNZ } from '../../lib/format';

type FilterKind = 'none' | 'action' | 'actor' | 'target';

export function AuditLogScreen() {
  const { members, nameOf } = useMembersDirectory();
  const [searchParams] = useSearchParams();
  const actionParam = searchParams.get('action');
  const initialAction = isOneOf(AUDIT_ACTIONS, actionParam) ? actionParam : null;

  const [filterKind, setFilterKind] = useState<FilterKind>(initialAction ? 'action' : 'none');
  const [actionFilter, setActionFilter] = useState<AuditAction>(initialAction ?? AUDIT_ACTIONS[0]);
  const [actorFilter, setActorFilter] = useState('');
  const [targetFilter, setTargetFilter] = useState('');

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function currentFilterArgs(): { action?: AuditAction; actorMemberId?: string; targetMemberId?: string } {
    if (filterKind === 'action') return { action: actionFilter };
    if (filterKind === 'actor' && actorFilter) return { actorMemberId: actorFilter };
    if (filterKind === 'target' && targetFilter) return { targetMemberId: targetFilter };
    return {};
  }

  async function load(reset: boolean) {
    setLoading(true);
    setError(null);
    try {
      const result = await listAuditLog({
        limit: 50,
        ...currentFilterArgs(),
        ...(reset ? {} : nextBefore ? { before: nextBefore } : {}),
      });
      setEntries((prev) => (reset ? result.entries : [...prev, ...result.entries]));
      setNextBefore(result.nextBefore);
    } catch (err) {
      setError(mapAdminActionError(err as AppError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setEntries([]);
    setNextBefore(undefined);
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKind, actionFilter, actorFilter, targetFilter]);

  function actorLabel(id: string): string {
    if (id === 'system') return 'System';
    return nameOf(id);
  }

  return (
    <div className="stack">
      <div className="card">
        <h1>Audit log</h1>

        <div className="field">
          <label htmlFor="audit-filter-kind">Filter by</label>
          <select
            id="audit-filter-kind"
            value={filterKind}
            onChange={(e) => setFilterKind(e.target.value as FilterKind)}
          >
            <option value="none">No filter</option>
            <option value="action">Action</option>
            <option value="actor">Actor</option>
            <option value="target">Target member</option>
          </select>
        </div>

        {filterKind === 'action' && (
          <div className="field">
            <label htmlFor="audit-action">Action</label>
            <select id="audit-action" value={actionFilter} onChange={(e) => setActionFilter(e.target.value as AuditAction)}>
              {AUDIT_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        )}

        {filterKind === 'actor' && (
          <div className="field">
            <label htmlFor="audit-actor">Actor</label>
            <select id="audit-actor" value={actorFilter} onChange={(e) => setActorFilter(e.target.value)}>
              <option value="">Choose a member</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.firstName} {m.lastName}
                </option>
              ))}
            </select>
          </div>
        )}

        {filterKind === 'target' && (
          <div className="field">
            <label htmlFor="audit-target">Target member</label>
            <select id="audit-target" value={targetFilter} onChange={(e) => setTargetFilter(e.target.value)}>
              <option value="">Choose a member</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.firstName} {m.lastName}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
      </div>

      <div className="card">
        {entries.length === 0 && !loading && <p className="muted">No audit entries match.</p>}
        {entries.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Time (NZ)</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Entity</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <Fragment key={entry.id}>
                    <tr>
                      <td>{formatDateTimeNZ(entry.at)}</td>
                      <td>{actorLabel(entry.actorMemberId)}</td>
                      <td>{entry.action}</td>
                      <td>{entry.targetMemberId ? nameOf(entry.targetMemberId) : '—'}</td>
                      <td>{entry.entityRef ?? '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="button button-link"
                          aria-expanded={expandedId === entry.id}
                          onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                        >
                          {expandedId === entry.id ? 'Hide details' : 'Details'}
                        </button>
                      </td>
                    </tr>
                    {expandedId === entry.id && (
                      <tr>
                        <td colSpan={6}>
                          <pre>{JSON.stringify({ detail: entry.detail, before: entry.before, after: entry.after }, null, 2)}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="actions-row">
          <button type="button" className="button button-secondary" disabled={loading || !nextBefore} onClick={() => void load(false)}>
            {loading ? 'Loading…' : nextBefore ? 'Load more' : 'No more entries'}
          </button>
        </div>
      </div>
    </div>
  );
}

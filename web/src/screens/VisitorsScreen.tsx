/**
 * "My visitors" (`/visitors`, plan §12.1/§12.6, Phase 4c task). List, add,
 * edit, delete a visitor. Every mutation goes through `createVisitor` /
 * `updateVisitor` / `deleteVisitor` (plan §3: no client Firestore writes).
 * A name-collision warning from `createVisitor` is shown as a non-blocking
 * notice; a delete blocked by future entries surfaces the server's
 * `failed-precondition` message verbatim (plan §12.6/§9.2).
 */
import { useState } from 'react';
import type { Visitor } from '@obc/shared';
import { useVisitors } from '../visitors/useVisitors';
import { createVisitor, deleteVisitor, updateVisitor } from '../api';
import { mapActionError } from '../lib/actionErrors';
import type { AppError } from '../firebase';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { VisitorForm, type VisitorFormValues } from '../components/VisitorForm';

export function VisitorsScreen() {
  const { visitors, loading } = useVisitors();

  const [adding, setAdding] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Visitor | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleCreate(values: VisitorFormValues) {
    setAddBusy(true);
    setAddError(null);
    setNotice(null);
    try {
      const result = await createVisitor(values);
      setAdding(false);
      setNotice(result.warnings.length > 0 ? result.warnings.join(' ') : `${result.visitor.displayName} added.`);
    } catch (err) {
      setAddError(mapActionError(err as AppError));
    } finally {
      setAddBusy(false);
    }
  }

  async function handleUpdate(visitorId: string, values: VisitorFormValues) {
    setEditBusy(true);
    setEditError(null);
    try {
      await updateVisitor({ visitorId, ...values });
      setEditingId(null);
      setNotice('Saved.');
    } catch (err) {
      setEditError(mapActionError(err as AppError));
    } finally {
      setEditBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteVisitor({ visitorId: deleteTarget.id });
      setDeleteTarget(null);
      setNotice(`${deleteTarget.displayName} removed.`);
    } catch (err) {
      setDeleteError(mapActionError(err as AppError));
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <h1>My visitors</h1>
        <p className="muted">People who aren&apos;t members that you sponsor to play with.</p>
      </div>

      {notice && (
        <div className="card alert-success" role="status">
          {notice}
        </div>
      )}

      <div className="card">
        {loading && <p>Loading…</p>}
        {!loading && visitors.length === 0 && !adding && <p className="muted">You haven&apos;t added any visitors yet.</p>}
        {!loading && visitors.length > 0 && (
          <ul className="roster-list">
            {visitors.map((v) => (
              <li key={v.id}>
                {editingId === v.id ? (
                  <VisitorForm
                    initial={v}
                    busy={editBusy}
                    error={editError}
                    submitLabel="Save"
                    onSubmit={(values) => void handleUpdate(v.id, values)}
                    onCancel={() => {
                      setEditingId(null);
                      setEditError(null);
                    }}
                  />
                ) : (
                  <div>
                    <strong>{v.displayName}</strong>
                    {v.promotedToMemberId && <span className="badge">now a member</span>}
                    {v.email && <span className="muted"> &middot; {v.email}</span>}
                    {v.phone && <span className="muted"> &middot; {v.phone}</span>}
                    {v.notes && <p className="muted">{v.notes}</p>}
                    <div className="actions-row">
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => {
                          setEditingId(v.id);
                          setEditError(null);
                          setAdding(false);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="button button-danger"
                        onClick={() => {
                          setDeleteTarget(v);
                          setDeleteError(null);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        {adding ? (
          <VisitorForm
            busy={addBusy}
            error={addError}
            submitLabel="Add visitor"
            onSubmit={(values) => void handleCreate(values)}
            onCancel={() => {
              setAdding(false);
              setAddError(null);
            }}
          />
        ) : (
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              setAdding(true);
              setEditingId(null);
            }}
          >
            Add a visitor
          </button>
        )}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="Delete this visitor?"
          body={`${deleteTarget.displayName} will be removed from your visitors list.`}
          confirmLabel="Delete"
          danger
          busy={deleteBusy}
          error={deleteError}
          onConfirm={() => void handleDelete()}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

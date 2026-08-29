/**
 * Admin: edit or remove a session (`updateSession`, plan §9.2, §9.3, Phase 6b
 * task deliverable 3). A date move is refused server-side while the session
 * has non-cancelled entries, or when the new date isn't the session's
 * weekday, or collides with an existing session — all `failed-precondition`/
 * `invalid-argument` messages shown verbatim (`mapAdminActionError`).
 * Removing a session cascades exactly like `cancelEntry` on every entry —
 * the confirm dialog spells that out before the admin commits.
 */
import { useState } from 'react';
import type { Session, SessionKind } from '@obc/shared';
import { SESSION_KINDS } from '@obc/shared';
import type { AppError } from '../../firebase';
import { updateSession } from '../../api';
import { mapAdminActionError } from '../../admin/adminErrors';
import { Dialog } from '../../components/Dialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';

export function SessionEditDialog({
  year,
  session,
  activeEntryCount,
  onClose,
  onSaved,
  onRemoved,
}: {
  year: number;
  session: Session;
  activeEntryCount: number;
  onClose: () => void;
  onSaved: (message: string) => void;
  onRemoved: (message: string) => void;
}) {
  const [title, setTitle] = useState(session.title);
  const [kind, setKind] = useState<SessionKind>(session.kind);
  const [partnerRequired, setPartnerRequired] = useState(session.partnerRequired);
  const [date, setDate] = useState(session.date);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await updateSession({
        year,
        sessionId: session.id,
        patch: {
          title,
          kind,
          partnerRequired,
          ...(date !== session.date ? { date } : {}),
        },
      });
      onSaved(`${title} updated.`);
    } catch (err) {
      setError(mapAdminActionError(err as AppError));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      await updateSession({ year, sessionId: session.id, patch: { remove: true } });
      onRemoved(`${session.title} on ${session.date} was removed.`);
    } catch (err) {
      setError(mapAdminActionError(err as AppError));
    } finally {
      setBusy(false);
    }
  }

  if (confirmingRemove) {
    return (
      <ConfirmDialog
        title="Remove this session?"
        body={
          activeEntryCount > 0
            ? `${activeEntryCount} non-cancelled sign-up${activeEntryCount === 1 ? '' : 's'} will be cancelled, partners notified, and any pending invite for this session expired.`
            : 'No one is signed up for this session.'
        }
        confirmLabel="Remove session"
        danger
        busy={busy}
        error={error}
        onClose={() => setConfirmingRemove(false)}
        onConfirm={() => void handleRemove()}
      />
    );
  }

  return (
    <Dialog title={`Edit session — ${session.date}`} onClose={onClose}>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <p className="muted">
        {activeEntryCount} non-cancelled sign-up{activeEntryCount === 1 ? '' : 's'}
        {activeEntryCount > 0 && ' — a date move is refused until these are cancelled.'}
      </p>
      <div className="field">
        <label htmlFor="session-title">Title</label>
        <input id="session-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="session-date">Date</label>
        <input id="session-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="session-kind">Kind</label>
        <select id="session-kind" value={kind} onChange={(e) => setKind(e.target.value as SessionKind)}>
          {SESSION_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <label className="checkbox-field">
        <input type="checkbox" checked={partnerRequired} onChange={(e) => setPartnerRequired(e.target.checked)} />
        Partner required
      </label>
      <div className="actions-row">
        <button type="button" className="button button-primary" disabled={busy} onClick={() => void handleSave()}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className="button button-danger" disabled={busy} onClick={() => setConfirmingRemove(true)}>
          Remove session
        </button>
        <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

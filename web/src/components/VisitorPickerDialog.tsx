/**
 * Pick one of the signed-in member's visitors, or add a new one inline
 * (plan §12.1/§12.2, Phase 4c task). Used for "Play with a visitor" (session
 * sign-up, with the optional "whole series" toggle) and a team captain's
 * "Add a visitor" (no series toggle).
 */
import { useState } from 'react';
import type { Visitor } from '@obc/shared';
import { Dialog } from './Dialog';
import { VisitorForm, type VisitorFormValues } from './VisitorForm';

export interface VisitorPickerDialogProps {
  title: string;
  visitors: Visitor[];
  /** Number of sessions in the series, when signing up for a series session — shows the "whole series" toggle. */
  seriesSessionCount?: number | undefined;
  busy: boolean;
  error?: string | null | undefined;
  onClose: () => void;
  onSelect: (visitorId: string, opts: { wholeSeries: boolean }) => void;
  onCreateVisitor: (values: VisitorFormValues) => Promise<Visitor>;
}

export function VisitorPickerDialog({
  title,
  visitors,
  seriesSessionCount,
  busy,
  error,
  onClose,
  onSelect,
  onCreateVisitor,
}: VisitorPickerDialogProps) {
  const [adding, setAdding] = useState(visitors.length === 0);
  const [wholeSeries, setWholeSeries] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleCreate(values: VisitorFormValues) {
    setCreateBusy(true);
    setCreateError(null);
    try {
      const visitor = await onCreateVisitor(values);
      onSelect(visitor.id, { wholeSeries });
    } catch (err) {
      setCreateError((err as { message?: string }).message ?? 'Could not add that visitor.');
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {seriesSessionCount != null && seriesSessionCount > 0 && (
        <label className="checkbox-field">
          <input type="checkbox" checked={wholeSeries} onChange={(e) => setWholeSeries(e.target.checked)} disabled={busy} />
          For the whole series ({seriesSessionCount} session{seriesSessionCount === 1 ? '' : 's'})
        </label>
      )}
      {!adding && (
        <>
          <ul className="member-picker-list">
            {visitors.length === 0 && <li className="muted member-picker-empty">You have no visitors yet.</li>}
            {visitors.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  className="member-picker-option"
                  disabled={busy}
                  onClick={() => onSelect(v.id, { wholeSeries })}
                >
                  <span>{v.displayName}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="actions-row">
            <button type="button" className="button button-link" onClick={() => setAdding(true)} disabled={busy}>
              Add a new visitor
            </button>
            <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </div>
        </>
      )}
      {adding && (
        <VisitorForm
          busy={createBusy || busy}
          error={createError}
          submitLabel="Add and continue"
          onSubmit={(values) => void handleCreate(values)}
          onCancel={visitors.length > 0 ? () => setAdding(false) : onClose}
        />
      )}
    </Dialog>
  );
}

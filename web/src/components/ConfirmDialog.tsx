import type { ReactNode } from 'react';
import { Dialog } from './Dialog';

export interface ConfirmDialogProps {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
  error?: string | null;
  danger?: boolean;
}

/** A generic accessible confirm/cancel dialog (plan Phase 3b task: cancel entry, claim a listing). */
export function ConfirmDialog({ title, body, confirmLabel, onConfirm, onClose, busy, error, danger }: ConfirmDialogProps) {
  return (
    <Dialog title={title} onClose={onClose}>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <p>{body}</p>
      <div className="actions-row">
        <button
          type="button"
          className={`button ${danger ? 'button-danger' : 'button-primary'}`}
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
        <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

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
  /**
   * Admin-only "override a locked session" checkbox (plan §6, Phase 6b task
   * deliverable 2: offered only while acting on behalf of a member). Pass
   * both `force`/`onForceChange` to render it; omit both to leave it out.
   */
  force?: boolean;
  onForceChange?: (value: boolean) => void;
}

/** A generic accessible confirm/cancel dialog (plan Phase 3b task: cancel entry, claim a listing). */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
  busy,
  error,
  danger,
  force,
  onForceChange,
}: ConfirmDialogProps) {
  return (
    <Dialog title={title} onClose={onClose}>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <p>{body}</p>
      {onForceChange && (
        <label className="checkbox-field">
          <input type="checkbox" checked={!!force} onChange={(e) => onForceChange(e.target.checked)} />
          Override a locked session (admin)
        </label>
      )}
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

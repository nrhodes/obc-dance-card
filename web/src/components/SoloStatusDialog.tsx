import { useState } from 'react';
import { Dialog } from './Dialog';

const NOTE_MAX = 120;

export interface SoloStatusDialogProps {
  status: 'looking_for_partner' | 'available';
  initialNote?: string;
  busy: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (note: string | undefined) => void;
}

/** "I'm looking for a partner" / "I'm available" dialog with an optional short note (plan Phase 3b task). */
export function SoloStatusDialog({ status, initialNote, busy, error, onClose, onSubmit }: SoloStatusDialogProps) {
  const [note, setNote] = useState(initialNote ?? '');
  const title = status === 'looking_for_partner' ? "I'm looking for a partner" : "I'm available";

  return (
    <Dialog title={title} onClose={onClose}>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <div className="field">
        <label htmlFor="solo-note">Note (optional)</label>
        <input id="solo-note" type="text" maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="actions-row">
        <button type="button" className="button button-primary" disabled={busy} onClick={() => onSubmit(note.trim() || undefined)}>
          {busy ? 'Saving…' : 'Confirm'}
        </button>
        <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

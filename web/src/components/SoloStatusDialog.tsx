import { useState } from 'react';
import { Dialog } from './Dialog';

const NOTE_MAX = 120;

export interface SoloStatusDialogProps {
  status: 'looking_for_partner' | 'available';
  /** Teams series read "looking for a team" / "available for a team" (plan §12A.4). Defaults to 'partner'. */
  entityLabel?: 'partner' | 'team';
  initialNote?: string;
  busy: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (note: string | undefined) => void;
}

const TITLES: Record<'partner' | 'team', Record<'looking_for_partner' | 'available', string>> = {
  partner: { looking_for_partner: "I'm looking for a partner", available: "I'm available" },
  team: { looking_for_partner: "I'm looking for a team", available: "I'm available for a team" },
};

/** "I'm looking for a partner" / "I'm available" dialog with an optional short note (plan Phase 3b task; Teams wording added Phase 4c). */
export function SoloStatusDialog({ status, entityLabel = 'partner', initialNote, busy, error, onClose, onSubmit }: SoloStatusDialogProps) {
  const [note, setNote] = useState(initialNote ?? '');
  const title = TITLES[entityLabel][status];

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

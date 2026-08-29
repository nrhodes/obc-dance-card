/**
 * "Start a team" dialog (plan §9.2 `createTeam`, §12A.2). Name is optional —
 * the server defaults it to "<captain surname> team".
 */
import { useState } from 'react';
import { Dialog } from './Dialog';

export interface StartTeamDialogProps {
  busy: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (name: string | undefined) => void;
}

export function StartTeamDialog({ busy, error, onClose, onSubmit }: StartTeamDialogProps) {
  const [name, setName] = useState('');

  return (
    <Dialog title="Start a team" onClose={onClose}>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <div className="field">
        <label htmlFor="team-name">Team name (optional)</label>
        <input id="team-name" type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
      </div>
      <div className="actions-row">
        <button type="button" className="button button-primary" disabled={busy} onClick={() => onSubmit(name.trim() || undefined)}>
          {busy ? 'Starting…' : 'Start team'}
        </button>
        <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

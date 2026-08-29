/**
 * "Transfer captaincy" dialog (plan §9.2 `transferCaptaincy`, §12A.2): pick a
 * team member, then confirm — the offer must be accepted before the
 * captaincy actually changes (a `kind: 'captaincy'` invite).
 */
import { useState } from 'react';
import { Dialog } from './Dialog';

export interface TransferCaptaincyCandidate {
  memberId: string;
  name: string;
}

export interface TransferCaptaincyDialogProps {
  candidates: TransferCaptaincyCandidate[];
  busy: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (toMemberId: string) => void;
}

export function TransferCaptaincyDialog({ candidates, busy, error, onClose, onSubmit }: TransferCaptaincyDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = candidates.find((c) => c.memberId === selectedId);

  if (selected) {
    return (
      <Dialog title={`Offer the captaincy to ${selected.name}?`} onClose={onClose}>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        <p>{selected.name} will need to accept before they become captain.</p>
        <div className="actions-row">
          <button type="button" className="button button-primary" disabled={busy} onClick={() => onSubmit(selected.memberId)}>
            {busy ? 'Sending…' : 'Send offer'}
          </button>
          <button type="button" className="button button-secondary" onClick={() => setSelectedId(null)} disabled={busy}>
            Choose someone else
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Transfer captaincy" onClose={onClose}>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <ul className="member-picker-list">
        {candidates.length === 0 && <li className="muted member-picker-empty">No other members on this team.</li>}
        {candidates.map((c) => (
          <li key={c.memberId}>
            <button type="button" className="member-picker-option" onClick={() => setSelectedId(c.memberId)}>
              <span>{c.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="actions-row">
        <button type="button" className="button button-secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

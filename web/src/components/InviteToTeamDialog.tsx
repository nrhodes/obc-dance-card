/**
 * "Invite a member" dialog for a team captain (plan §9.2 `inviteToTeam`,
 * §12A.2). Search + pick a member (excluding self and anyone already on the
 * team — the server reports any other conflict verbatim), optional message.
 */
import { useMemo, useState } from 'react';
import type { Member } from '@obc/shared';
import { filterPickableMembers } from '../lib/memberPicker';
import { Dialog } from './Dialog';

const MESSAGE_MAX = 200;

export interface InviteToTeamDialogProps {
  members: Member[];
  selfId: string;
  excludeMemberIds: Iterable<string>;
  busy: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (input: { toMemberId: string; message?: string }) => void;
}

export function InviteToTeamDialog({ members, selfId, excludeMemberIds, busy, error, onClose, onSubmit }: InviteToTeamDialogProps) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const excludeSet = useMemo(() => new Set(excludeMemberIds), [excludeMemberIds]);
  const options = useMemo(
    () => filterPickableMembers(members, { selfId, excludeMemberIds: excludeSet, query }),
    [members, selfId, excludeSet, query],
  );
  const selectedMember = selectedId ? members.find((m) => m.id === selectedId) : undefined;

  if (selectedMember) {
    return (
      <Dialog title={`Invite ${selectedMember.firstName} ${selectedMember.lastName}`} onClose={onClose}>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        <div className="field">
          <label htmlFor="team-invite-message">Message (optional)</label>
          <textarea
            id="team-invite-message"
            rows={3}
            maxLength={MESSAGE_MAX}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>
        <div className="actions-row">
          <button type="button" className="button button-link" onClick={() => setSelectedId(null)} disabled={busy}>
            Choose someone else
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={busy}
            onClick={() => {
              const trimmed = message.trim();
              onSubmit({ toMemberId: selectedMember.id, ...(trimmed ? { message: trimmed } : {}) });
            }}
          >
            {busy ? 'Sending…' : 'Send invite'}
          </button>
          <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Invite a member" onClose={onClose}>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <div className="field">
        <label htmlFor="team-invite-search">Search members</label>
        <input id="team-invite-search" type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a name…" />
      </div>
      <ul className="member-picker-list">
        {options.length === 0 && <li className="muted member-picker-empty">No members found.</li>}
        {options.map((m) => (
          <li key={m.id}>
            <button type="button" className="member-picker-option" onClick={() => setSelectedId(m.id)}>
              <span>
                {m.firstName} {m.lastName}
              </span>
              <span className="badge">{m.grade}</span>
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

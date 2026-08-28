/**
 * "Invite a partner" dialog (plan Phase 3b task, deliverable 3). Two steps:
 * search + pick a member (skipped when opened from a roster row's "Invite
 * <name>" quick action, via `initialMemberId`), then an optional message and
 * — for a series session — a "whole series" scope toggle, before calling
 * `onSubmit`.
 */
import { useMemo, useState } from 'react';
import type { Member } from '@obc/shared';
import { filterPickableMembers } from '../lib/memberPicker';
import { Dialog } from './Dialog';

const MESSAGE_MAX = 200;

export interface InvitePartnerDialogProps {
  members: Member[];
  selfId: string;
  excludeMemberIds: Iterable<string>;
  /** Number of sessions in this session's series, when it belongs to one. */
  seriesSessionCount?: number | undefined;
  initialMemberId?: string | null;
  busy: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (input: { toMemberId: string; message?: string; scope: 'session' | 'series' }) => void;
}

export function InvitePartnerDialog({
  members,
  selfId,
  excludeMemberIds,
  seriesSessionCount,
  initialMemberId,
  busy,
  error,
  onClose,
  onSubmit,
}: InvitePartnerDialogProps) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initialMemberId ?? null);
  const [message, setMessage] = useState('');
  const [wholeSeries, setWholeSeries] = useState(false);

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
          <label htmlFor="invite-message">Message (optional)</label>
          <textarea
            id="invite-message"
            rows={3}
            maxLength={MESSAGE_MAX}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>
        {seriesSessionCount != null && seriesSessionCount > 0 && (
          <label className="checkbox-field">
            <input type="checkbox" checked={wholeSeries} onChange={(e) => setWholeSeries(e.target.checked)} />
            Invite for the whole series ({seriesSessionCount} session{seriesSessionCount === 1 ? '' : 's'})
          </label>
        )}
        <div className="actions-row">
          {!initialMemberId && (
            <button type="button" className="button button-link" onClick={() => setSelectedId(null)} disabled={busy}>
              Choose someone else
            </button>
          )}
          <button
            type="button"
            className="button button-primary"
            disabled={busy}
            onClick={() => {
              const trimmed = message.trim();
              onSubmit({
                toMemberId: selectedMember.id,
                scope: wholeSeries ? 'series' : 'session',
                ...(trimmed ? { message: trimmed } : {}),
              });
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
    <Dialog title="Invite a partner" onClose={onClose}>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <div className="field">
        <label htmlFor="invite-search">Search members</label>
        <input id="invite-search" type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a name…" />
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

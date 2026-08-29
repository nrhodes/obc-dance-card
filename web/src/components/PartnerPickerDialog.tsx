/**
 * Pick a club member, or one of the signed-in member's visitors (adding a
 * new one inline), to fill a `PartnerRef` slot (plan §9.2 `setSubstitute` /
 * `addTeamSessionSubstitute`, both of which accept `{kind:'member',
 * memberId}` or `{kind:'visitor', visitorId}`). `members` and `visitors` are
 * pre-filtered candidate pools — this component only searches/renders them.
 */
import { useMemo, useState } from 'react';
import type { Member, SetSubstituteInput, Visitor } from '@obc/shared';
import { filterPickableMembers } from '../lib/memberPicker';
import { Dialog } from './Dialog';
import { VisitorForm, type VisitorFormValues } from './VisitorForm';

/** The shape `setSubstitute`/`addTeamSessionSubstitute`'s `substitute`/`ref` fields expect — a bare member/visitor ref, no display name. */
export type PartnerRefInput = SetSubstituteInput['substitute'];

export interface PartnerPickerDialogProps {
  title: string;
  members: Member[];
  visitors: Visitor[];
  busy: boolean;
  error?: string | null | undefined;
  onClose: () => void;
  onSelectMember: (memberId: string) => void;
  onSelectVisitor: (visitorId: string) => void;
  onCreateVisitor: (values: VisitorFormValues) => Promise<Visitor>;
}

export function PartnerPickerDialog({
  title,
  members,
  visitors,
  busy,
  error,
  onClose,
  onSelectMember,
  onSelectVisitor,
  onCreateVisitor,
}: PartnerPickerDialogProps) {
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const options = useMemo(
    () => filterPickableMembers(members, { selfId: '', excludeMemberIds: [], query }),
    [members, query],
  );

  async function handleCreate(values: VisitorFormValues) {
    setCreateBusy(true);
    setCreateError(null);
    try {
      const visitor = await onCreateVisitor(values);
      onSelectVisitor(visitor.id);
    } catch (err) {
      setCreateError((err as { message?: string }).message ?? 'Could not add that visitor.');
    } finally {
      setCreateBusy(false);
    }
  }

  if (adding) {
    return (
      <Dialog title="Add a new visitor" onClose={onClose}>
        <VisitorForm
          busy={createBusy || busy}
          error={createError}
          submitLabel="Add and continue"
          onSubmit={(values) => void handleCreate(values)}
          onCancel={() => setAdding(false)}
        />
      </Dialog>
    );
  }

  return (
    <Dialog title={title} onClose={onClose}>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <div className="field">
        <label htmlFor="partner-picker-search">Search members</label>
        <input
          id="partner-picker-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a name…"
        />
      </div>
      <ul className="member-picker-list">
        {options.length === 0 && <li className="muted member-picker-empty">No members found.</li>}
        {options.map((m: Member) => (
          <li key={m.id}>
            <button type="button" className="member-picker-option" disabled={busy} onClick={() => onSelectMember(m.id)}>
              <span>
                {m.firstName} {m.lastName}
              </span>
              <span className="badge">{m.grade}</span>
            </button>
          </li>
        ))}
      </ul>
      {visitors.length > 0 && (
        <>
          <h3>My visitors</h3>
          <ul className="member-picker-list">
            {visitors.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  className="member-picker-option"
                  disabled={busy}
                  onClick={() => onSelectVisitor(v.id)}
                >
                  <span>{v.displayName}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="actions-row">
        <button type="button" className="button button-link" onClick={() => setAdding(true)} disabled={busy}>
          Add a new visitor
        </button>
        <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

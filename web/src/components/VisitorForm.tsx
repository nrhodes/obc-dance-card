/**
 * Add/edit visitor form (plan §12.1, Phase 4c task). "Send them a
 * confirmation email" is only enabled once an email address is entered
 * (plan §12.1: "off by default, only enabled if email given"). Used inline
 * on the "My visitors" screen (add/edit) and inside the visitor pickers'
 * "Add a new visitor" step.
 */
import { useState } from 'react';
import type { Visitor } from '@obc/shared';

export interface VisitorFormValues {
  displayName: string;
  email?: string;
  phone?: string;
  notes?: string;
  courtesyEmails?: boolean;
}

export interface VisitorFormProps {
  initial?: Visitor;
  busy: boolean;
  error?: string | null;
  submitLabel: string;
  onSubmit: (values: VisitorFormValues) => void;
  onCancel?: () => void;
}

export function VisitorForm({ initial, busy, error, submitLabel, onSubmit, onCancel }: VisitorFormProps) {
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [courtesyEmails, setCourtesyEmails] = useState(initial?.courtesyEmails ?? false);

  const trimmedName = displayName.trim();
  const trimmedEmail = email.trim();

  function handleSubmit() {
    if (!trimmedName) return;
    onSubmit({
      displayName: trimmedName,
      ...(trimmedEmail ? { email: trimmedEmail } : {}),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      courtesyEmails: trimmedEmail ? courtesyEmails : false,
    });
  }

  return (
    <div className="stack">
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <div className="field">
        <label htmlFor="visitor-name">Name</label>
        <input id="visitor-name" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="visitor-email">Email (optional)</label>
        <input
          id="visitor-email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (!e.target.value.trim()) setCourtesyEmails(false);
          }}
        />
      </div>
      <div className="field">
        <label htmlFor="visitor-phone">Phone (optional)</label>
        <input id="visitor-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="visitor-notes">Notes (optional)</label>
        <textarea id="visitor-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={courtesyEmails}
          disabled={!trimmedEmail}
          onChange={(e) => setCourtesyEmails(e.target.checked)}
        />
        Send them a confirmation email
      </label>
      <div className="actions-row">
        <button type="button" className="button button-primary" disabled={busy || !trimmedName} onClick={handleSubmit}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="button button-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

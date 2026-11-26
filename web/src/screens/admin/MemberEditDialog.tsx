/**
 * Admin: add one member by hand, or edit an existing member's name, email,
 * phone and grade (`addMember` / `updateMember`, plan §9.2, amended
 * 2026-11-27). `member === null` is "add".
 *
 * Role and active state are NOT edited here — they keep their own row
 * actions (Make/Remove admin, Deactivate/Reactivate), each with its own
 * confirmation and server-side guard. On edit, only fields that actually
 * changed are sent.
 */
import { useState, type FormEvent } from 'react';
import { MEMBER_GRADES, type Member, type MemberGrade, type UpdateMemberInput } from '@obc/shared';
import type { AppError } from '../../firebase';
import { addMember, updateMember } from '../../api';
import { mapAdminActionError } from '../../admin/adminErrors';
import { Dialog } from '../../components/Dialog';

/** Deliberately loose — the server (zod `.email()`) is the real check; this only catches obvious slips. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function MemberEditDialog({
  member,
  onClose,
  onSaved,
}: {
  member: Member | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [firstName, setFirstName] = useState(member?.firstName ?? '');
  const [lastName, setLastName] = useState(member?.lastName ?? '');
  const [email, setEmail] = useState(member?.email ?? '');
  const [phone, setPhone] = useState(member?.phone ?? '');
  const [grade, setGrade] = useState<MemberGrade>(member?.grade ?? 'Unknown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailNorm = email.trim().toLowerCase();
  const originalEmail = member?.email ?? '';
  const emailChanged = member !== null && emailNorm !== originalEmail;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const first = firstName.trim();
    const last = lastName.trim();
    const phoneTrimmed = phone.trim();
    if (!first || !last) {
      setError('First and last name are both required.');
      return;
    }
    // An older member doc may have no email on it: leaving the box empty then means "don't touch it".
    const emailRequired = member === null || emailChanged;
    if (emailRequired && !EMAIL_SHAPE.test(emailNorm)) {
      setError('Enter a valid email address.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const name = `${first} ${last}`;
      if (member === null) {
        await addMember({ firstName: first, lastName: last, email: emailNorm, phone: phoneTrimmed, grade });
        onSaved(`${name} has been added. They can sign in with ${emailNorm} straight away.`);
        return;
      }

      const patch: UpdateMemberInput['patch'] = {};
      if (first !== member.firstName) patch.firstName = first;
      if (last !== member.lastName) patch.lastName = last;
      if (emailChanged) patch.email = emailNorm;
      if (phoneTrimmed !== member.phone) patch.phone = phoneTrimmed;
      if (grade !== member.grade) patch.grade = grade;

      if (Object.keys(patch).length === 0) {
        onSaved(`${name}: nothing changed.`);
        return;
      }
      await updateMember({ memberId: member.id, patch });
      onSaved(`${name} updated.`);
    } catch (err) {
      setError(mapAdminActionError(err as AppError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={member ? `Edit ${member.firstName} ${member.lastName}` : 'Add a member'} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)} noValidate>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        <div className="field">
          <label htmlFor="member-first-name">First name</label>
          <input
            id="member-first-name"
            type="text"
            autoComplete="off"
            maxLength={80}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="member-last-name">Last name</label>
          <input
            id="member-last-name"
            type="text"
            autoComplete="off"
            maxLength={80}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="member-email">Email</label>
          <input
            id="member-email"
            type="email"
            autoComplete="off"
            maxLength={320}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {member === null && <p className="muted">This is the address they sign in with.</p>}
          {emailChanged && (
            <p className="muted">
              This changes the address {member.firstName} signs in with. The members CSV matches people by email, so
              the next import file needs the new address too.
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="member-phone">Phone</label>
          <input
            id="member-phone"
            type="tel"
            autoComplete="off"
            maxLength={40}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="member-grade">Grade</label>
          <select id="member-grade" value={grade} onChange={(e) => setGrade(e.target.value as MemberGrade)}>
            {MEMBER_GRADES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        {member === null && (
          <p className="muted">
            A CSV import still treats its file as the full membership list: anyone missing from it — including a
            member added here — is deactivated by that import.
          </p>
        )}
        <div className="actions-row">
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? 'Saving…' : member ? 'Save changes' : 'Add member'}
          </button>
          <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

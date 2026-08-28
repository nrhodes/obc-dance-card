import { useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { updateMyContact } from '../api';
import { toAppError } from '../firebase';
import { mapGenericError } from '../auth/errors';
import { NotificationPrefsForm } from './NotificationPrefsForm';
import { PasswordSection } from './PasswordSection';

export function ProfileScreen() {
  const { member, memberPrivate, signOut } = useAuth();

  if (!member || !memberPrivate) {
    return <p>Loading…</p>;
  }

  return (
    <div className="stack">
      <div className="card">
        <h1>Profile</h1>
        <p>
          <strong>Name:</strong> {member.firstName} {member.lastName}
        </p>
        <p>
          <strong>Grade:</strong> {member.grade}
        </p>
        <p>
          <strong>Email:</strong> {memberPrivate.emailLower}
        </p>
        <ContactForm initialPhone={member.phone} />
      </div>

      <div className="card">
        <NotificationPrefsForm initialPrefs={memberPrivate.notificationPrefs} />
      </div>

      <div className="card">
        <PasswordSection hasPassword={memberPrivate.hasPassword} email={memberPrivate.emailLower} />
      </div>

      <div className="card">
        <button type="button" className="button button-primary" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}

function ContactForm({ initialPhone }: { initialPhone: string }) {
  const [phone, setPhone] = useState(initialPhone);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateMyContact({ phone });
      setSaved(true);
    } catch (err) {
      setError(mapGenericError(toAppError(err)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {saved && (
        <div className="alert alert-success" role="status">
          Saved.
        </div>
      )}
      <div className="field">
        <label htmlFor="phone">Phone</label>
        <input
          id="phone"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setSaved(false);
          }}
        />
      </div>
      <button type="button" className="button button-secondary" disabled={saving} onClick={() => void handleSave()}>
        {saving ? 'Saving…' : 'Save phone number'}
      </button>
    </div>
  );
}

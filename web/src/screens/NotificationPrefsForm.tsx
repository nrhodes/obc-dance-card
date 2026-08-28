import { useState } from 'react';
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from '@obc/shared';
import { updateMyPrefs } from '../api';
import { toAppError } from '../firebase';
import { mapGenericError } from '../auth/errors';

export interface NotificationPrefsFormProps {
  initialPrefs: NotificationPrefs | undefined;
}

const REMINDER_DAY_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7];

export function NotificationPrefsForm({ initialPrefs }: NotificationPrefsFormProps) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(initialPrefs ?? DEFAULT_NOTIFICATION_PREFS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateMyPrefs(prefs);
      setSaved(true);
    } catch (err) {
      setError(mapGenericError(toAppError(err)));
    } finally {
      setSaving(false);
    }
  }

  function update<K extends keyof NotificationPrefs>(key: K, value: NotificationPrefs[K]) {
    setPrefs((p) => ({ ...p, [key]: value }));
    setSaved(false);
  }

  return (
    <div>
      <h2>Notifications</h2>
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

      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={prefs.push}
          onChange={(e) => update('push', e.target.checked)}
        />
        Push notifications
      </label>

      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={prefs.email}
          onChange={(e) => update('email', e.target.checked)}
        />
        Email notifications
      </label>

      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={prefs.reminders}
          onChange={(e) => update('reminders', e.target.checked)}
        />
        Session reminders
      </label>

      {prefs.reminders && (
        <div className="field">
          <label htmlFor="reminder-days">Remind me this many days before</label>
          <select
            id="reminder-days"
            value={prefs.reminderDaysBefore}
            onChange={(e) => update('reminderDaysBefore', Number(e.target.value))}
          >
            {REMINDER_DAY_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'On the day' : `${n} day${n === 1 ? '' : 's'} before`}
              </option>
            ))}
          </select>
        </div>
      )}

      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={prefs.matchmakingAlerts}
          onChange={(e) => update('matchmakingAlerts', e.target.checked)}
        />
        Tell me when someone is looking for a partner
      </label>

      <div className="field">
        <label htmlFor="digest-mode">Email frequency</label>
        <select
          id="digest-mode"
          value={prefs.digest}
          onChange={(e) => update('digest', e.target.value as NotificationPrefs['digest'])}
        >
          <option value="immediate">Send each one right away</option>
          <option value="daily">Send one summary a day</option>
        </select>
      </div>

      <button type="button" className="button button-primary" disabled={saving} onClick={() => void handleSave()}>
        {saving ? 'Saving…' : 'Save preferences'}
      </button>
    </div>
  );
}

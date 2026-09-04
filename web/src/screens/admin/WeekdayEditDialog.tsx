/**
 * Admin: edit a weekday programme doc (`updateWeekday`, plan §9.2, §5.4).
 * Closes the "changing a mid-year steward needs a full CSV re-import" gap
 * (decided 2026-09-05) — label, times, the single partner steward, and notes
 * are all editable here instead. Only fields that actually changed are sent:
 * clearing the steward select back to "None", or blanking the notes
 * textarea, sends an explicit `null` for that field (the callable's clear
 * signal) rather than omitting it.
 */
import { useMemo, useState } from 'react';
import type { UpdateWeekdayPatch, WeekdayProgramme } from '@obc/shared';
import type { AppError } from '../../firebase';
import { updateWeekday } from '../../api';
import { mapAdminActionError } from '../../admin/adminErrors';
import { Dialog } from '../../components/Dialog';
import { useMembersDirectory } from '../../members/useMembersDirectory';

export function WeekdayEditDialog({
  year,
  weekday,
  onClose,
  onSaved,
}: {
  year: number;
  weekday: WeekdayProgramme;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { members } = useMembersDirectory();
  const [label, setLabel] = useState(weekday.label);
  const [startTime, setStartTime] = useState(weekday.startTime);
  const [seatedByTime, setSeatedByTime] = useState(weekday.seatedByTime);
  const [stewardId, setStewardId] = useState(weekday.partnerStewardMemberId ?? '');
  const [notes, setNotes] = useState(weekday.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)),
    [members],
  );

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const patch: UpdateWeekdayPatch = {};
      const trimmedLabel = label.trim();
      if (trimmedLabel !== weekday.label) patch.label = trimmedLabel;
      if (startTime !== weekday.startTime) patch.startTime = startTime;
      if (seatedByTime !== weekday.seatedByTime) patch.seatedByTime = seatedByTime;

      const currentStewardId = weekday.partnerStewardMemberId ?? null;
      const nextStewardId = stewardId === '' ? null : stewardId;
      if (nextStewardId !== currentStewardId) patch.partnerStewardMemberId = nextStewardId;

      const currentNotes = weekday.notes ?? '';
      const trimmedNotes = notes.trim();
      if (trimmedNotes !== currentNotes) patch.notes = trimmedNotes === '' ? null : trimmedNotes;

      if (Object.keys(patch).length === 0) {
        onSaved(`${weekday.label}: nothing changed.`);
        return;
      }

      await updateWeekday({ year, weekday: weekday.weekday, patch });
      onSaved(`${trimmedLabel || weekday.label} updated.`);
    } catch (err) {
      setError(mapAdminActionError(err as AppError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Edit ${weekday.label}`} onClose={onClose}>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <div className="field">
        <label htmlFor="weekday-label">Label</label>
        <input id="weekday-label" type="text" value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="actions-row">
        <div className="field">
          <label htmlFor="weekday-start-time">Start time</label>
          <input id="weekday-start-time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="weekday-seated-by">Seated by</label>
          <input id="weekday-seated-by" type="time" value={seatedByTime} onChange={(e) => setSeatedByTime(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="weekday-steward">Partner steward</label>
        <select id="weekday-steward" value={stewardId} onChange={(e) => setStewardId(e.target.value)}>
          <option value="">None</option>
          {sortedMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.lastName}, {m.firstName}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="weekday-notes">Notes</label>
        <textarea id="weekday-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="actions-row">
        <button type="button" className="button button-primary" disabled={busy} onClick={() => void handleSave()}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

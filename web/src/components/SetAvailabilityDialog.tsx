/**
 * "Set availability…" bulk dialog (plan §21 B2). Lets a member mark
 * themselves available/unavailable/clear across every matching session in
 * one go, filtered by weekday and an optional date range — the client-side
 * counterpart to the `setBulkSoloStatus` callable
 * (`firebase/functions/src/entries/bulkSoloStatus.ts`).
 *
 * The live preview (`previewBulkAvailability`, `lib/bulkAvailability.ts`)
 * mirrors the server's weekday/date-range/bookable filtering and "a booked
 * session is never touched" rule, but deliberately not its session-lock
 * check or 200-session cap — the plan settles that the server enforces both
 * and the preview may say "about N" (session-cutoff timing drifting a few
 * seconds between client and server render is not worth chasing here).
 */
import { useState } from 'react';
import { WEEKDAYS, todayNZ, type Entry, type IsoDate, type Session, type Weekday } from '@obc/shared';
import { Dialog } from './Dialog';
import { previewBulkAvailability } from '../lib/bulkAvailability';

export type BulkAvailabilityStatus = 'available' | 'unavailable' | 'clear';

export interface SetAvailabilityDialogProps {
  sessions: readonly Session[];
  entries: readonly Entry[];
  /** Default `toDate` — the end of the newest loaded published year. */
  defaultToDate: IsoDate;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (input: { status: BulkAvailabilityStatus; weekdays: Weekday[]; fromDate: IsoDate; toDate: IsoDate }) => void;
}

const STATUS_OPTIONS: Array<{ value: BulkAvailabilityStatus; label: string; blurb: string }> = [
  { value: 'available', label: 'Available', blurb: 'Show me as free on the noticeboard — anyone can invite me.' },
  { value: 'unavailable', label: 'Unavailable', blurb: "Don't show me as free and don't let others invite me." },
  { value: 'clear', label: 'Clear', blurb: "Remove any noticeboard listing or unavailable marker — back to nothing set." },
];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function SetAvailabilityDialog({ sessions, entries, defaultToDate, busy, error, onClose, onConfirm }: SetAvailabilityDialogProps) {
  const [status, setStatus] = useState<BulkAvailabilityStatus>('available');
  const [weekdays, setWeekdays] = useState<Weekday[]>([]);
  const [fromDate, setFromDate] = useState<IsoDate>(todayNZ());
  const [toDate, setToDate] = useState<IsoDate>(defaultToDate);

  function toggleWeekday(wd: Weekday) {
    setWeekdays((prev) => (prev.includes(wd) ? prev.filter((w) => w !== wd) : [...prev, wd]));
  }

  const dateRangeValid = fromDate <= toDate;
  const canConfirm = weekdays.length > 0 && dateRangeValid && !busy;

  const preview = weekdays.length > 0 && dateRangeValid ? previewBulkAvailability(sessions, entries, { weekdays, fromDate, toDate }) : null;
  const statusLabel = status === 'clear' ? 'cleared' : status;

  return (
    <Dialog title="Set availability" onClose={onClose}>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      <fieldset className="fieldset-plain">
        <legend>Status</legend>
        {STATUS_OPTIONS.map((opt) => (
          <label key={opt.value} className="checkbox-field radio-option">
            <input type="radio" name="bulk-status" value={opt.value} checked={status === opt.value} onChange={() => setStatus(opt.value)} />
            <span>
              <strong>{opt.label}</strong> — {opt.blurb}
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="fieldset-plain">
        <legend>Weekdays</legend>
        {WEEKDAYS.map((wd) => (
          <label key={wd} className="checkbox-field">
            <input type="checkbox" checked={weekdays.includes(wd)} onChange={() => toggleWeekday(wd)} />
            {capitalize(wd)}
          </label>
        ))}
      </fieldset>

      <div className="field">
        <label htmlFor="bulk-from-date">From</label>
        <input id="bulk-from-date" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="bulk-to-date">To</label>
        <input id="bulk-to-date" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
      </div>

      {!dateRangeValid && (
        <div className="alert alert-error" role="alert">
          The from date must be on or before the to date.
        </div>
      )}

      <p role="status">
        {weekdays.length === 0
          ? 'Choose at least one weekday to see a preview.'
          : !dateRangeValid
            ? ''
            : preview && preview.bookedSkipped > 0
              ? `This will mark about ${preview.toUpdate} session${preview.toUpdate === 1 ? '' : 's'} as ${statusLabel}. ${preview.bookedSkipped} booked session${preview.bookedSkipped === 1 ? '' : 's'} will not be changed.`
              : `This will mark about ${preview?.toUpdate ?? 0} session${preview?.toUpdate === 1 ? '' : 's'} as ${statusLabel}.`}
      </p>

      <div className="actions-row">
        <button
          type="button"
          className="button button-primary"
          disabled={!canConfirm}
          onClick={() => onConfirm({ status, weekdays, fromDate, toDate })}
        >
          {busy ? 'Working…' : 'Confirm'}
        </button>
        <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

/**
 * Admin: Broadcast (`broadcast`, plan §9.2, Phase 6b task deliverable 4). The
 * preview count mirrors `broadcastHandler`'s own recipient computation
 * exactly (plan §9.2 row: "active members / those with future non-cancelled
 * entries on the weekdays") so what the admin sees before sending matches
 * what the server will actually do.
 */
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { paths, todayNZ, WEEKDAYS, type Entry, type Weekday } from '@obc/shared';
import type { AppError } from '../../firebase';
import { db } from '../../firebase';
import { broadcast } from '../../api';
import { mapAdminActionError } from '../../admin/adminErrors';
import { useMembersDirectory } from '../../members/useMembersDirectory';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { SubscriptionError } from '../../components/SubscriptionError';

const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
};

export function BroadcastScreen() {
  const { members: activeMembers, error: membersError } = useMembersDirectory();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [weekdays, setWeekdays] = useState<Weekday[]>([]);
  const [futureEntries, setFutureEntries] = useState<Entry[]>([]);
  const [entriesError, setEntriesError] = useState<{ code: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<number | null>(null);

  useEffect(() => {
    const today = todayNZ();
    return onSnapshot(
      query(collection(db, paths.entries()), where('date', '>=', today)),
      (snap) => {
        setFutureEntries(snap.docs.map((d) => d.data() as Entry));
        setEntriesError(null);
      },
      (err) => {
        console.error('subscription_failed', 'admin_broadcast_entries', err.code);
        setEntriesError({ code: err.code });
      },
    );
  }, []);

  const previewCount = useMemo(() => {
    if (weekdays.length === 0) return activeMembers.length;
    const weekdaySet = new Set(weekdays);
    const withMatchingSession = new Set<string>();
    for (const e of futureEntries) {
      if (e.status === 'cancelled') continue;
      if (weekdaySet.has(e.weekday)) withMatchingSession.add(e.memberId);
    }
    const activeIds = new Set(activeMembers.map((m) => m.id));
    let count = 0;
    for (const id of withMatchingSession) if (activeIds.has(id)) count += 1;
    return count;
  }, [weekdays, futureEntries, activeMembers]);

  function toggleWeekday(w: Weekday) {
    setWeekdays((prev) => (prev.includes(w) ? prev.filter((x) => x !== w) : [...prev, w]));
  }

  const canSend = title.trim().length > 0 && title.length <= 80 && body.trim().length > 0 && body.length <= 1000;

  async function handleSend() {
    setBusy(true);
    setError(null);
    try {
      const res = await broadcast({
        title: title.trim(),
        body: body.trim(),
        ...(weekdays.length > 0 ? { weekdays } : {}),
      });
      setResult(res.recipients);
      setConfirming(false);
      setTitle('');
      setBody('');
      setWeekdays([]);
    } catch (err) {
      setError(mapAdminActionError(err as AppError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <h1>Broadcast</h1>
        {membersError && <SubscriptionError resource="members" />}
        {entriesError && <SubscriptionError resource="upcoming entries" />}

        {result != null && (
          <div className="alert alert-success" role="status">
            Sent to {result} member{result === 1 ? '' : 's'}.
          </div>
        )}

        <div className="field">
          <label htmlFor="broadcast-title">Title (max 80 characters)</label>
          <input id="broadcast-title" type="text" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="broadcast-body">Message (max 1000 characters)</label>
          <textarea id="broadcast-body" rows={6} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <fieldset>
          <legend>Only members with a future session on (optional)</legend>
          {WEEKDAYS.map((w) => (
            <label key={w} className="checkbox-field">
              <input type="checkbox" checked={weekdays.includes(w)} onChange={() => toggleWeekday(w)} />
              {WEEKDAY_LABELS[w]}
            </label>
          ))}
        </fieldset>

        <p>
          This will notify <strong>{previewCount}</strong> member{previewCount === 1 ? '' : 's'}
          {weekdays.length === 0 ? ' (all active members)' : ''}.
        </p>

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        <div className="actions-row">
          <button type="button" className="button button-primary" disabled={!canSend} onClick={() => setConfirming(true)}>
            Preview &amp; send
          </button>
        </div>
      </div>

      {confirming && (
        <ConfirmDialog
          title="Send this broadcast?"
          body={`This will notify ${previewCount} member${previewCount === 1 ? '' : 's'}. "${title}" — ${body}`}
          confirmLabel="Send"
          busy={busy}
          error={error}
          onConfirm={() => void handleSend()}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

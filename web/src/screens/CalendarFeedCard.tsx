/**
 * "Calendar feed" card on the Profile screen (plan §21 B1). Lets a member
 * create/display/reset/remove their iCal subscription URL — the app's one
 * unauthenticated read endpoint, so the copy is deliberately blunt about
 * treating the link like a password.
 */
import { useEffect, useState } from 'react';
import type { GetIcalFeedResult } from '@obc/shared';
import { createIcalFeed, getIcalFeed, removeIcalFeed, rotateIcalFeed } from '../api';
import { toAppError } from '../firebase';
import { mapActionError } from '../lib/actionErrors';
import { ConfirmDialog } from '../components/ConfirmDialog';

type FeedState = { url: string; webcalUrl: string } | null;

export function CalendarFeedCard() {
  const [loading, setLoading] = useState(true);
  const [feed, setFeed] = useState<FeedState>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);

  const [confirming, setConfirming] = useState<'reset' | 'remove' | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result: GetIcalFeedResult = await getIcalFeed({});
        if (cancelled) return;
        setFeed(result.url ? { url: result.url, webcalUrl: result.webcalUrl } : null);
      } catch (err) {
        if (!cancelled) setLoadError(mapActionError(toAppError(err)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      const result = await createIcalFeed({});
      setFeed({ url: result.url, webcalUrl: result.webcalUrl });
    } catch (err) {
      setCreateError(mapActionError(toAppError(err)));
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy() {
    if (!feed) return;
    try {
      await navigator.clipboard.writeText(feed.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Fallback: select the text so the member can copy manually (plan spec).
      const input = document.getElementById('ical-feed-url') as HTMLInputElement | null;
      input?.select();
    }
  }

  async function handleConfirm() {
    if (!confirming) return;
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      if (confirming === 'reset') {
        const result = await rotateIcalFeed({});
        setFeed({ url: result.url, webcalUrl: result.webcalUrl });
      } else {
        await removeIcalFeed({});
        setFeed(null);
      }
      setConfirming(null);
    } catch (err) {
      setConfirmError(mapActionError(toAppError(err)));
    } finally {
      setConfirmBusy(false);
    }
  }

  return (
    <div>
      <h2>Calendar feed</h2>
      <p className="muted">
        Subscribe from Apple or Google Calendar. Anyone with this link can see your bridge schedule —
        treat it like a password.
      </p>

      {loading && <p className="muted">Loading…</p>}

      {!loading && loadError && (
        <div className="alert alert-error" role="alert">
          {loadError}
        </div>
      )}

      {!loading && !loadError && !feed && (
        <div>
          {createError && (
            <div className="alert alert-error" role="alert">
              {createError}
            </div>
          )}
          <button type="button" className="button button-primary" disabled={creating} onClick={() => void handleCreate()}>
            {creating ? 'Creating…' : 'Create calendar link'}
          </button>
        </div>
      )}

      {!loading && feed && (
        <div className="stack">
          {copied && (
            <div className="alert alert-success" role="status">
              Copied.
            </div>
          )}
          <div className="field">
            <label htmlFor="ical-feed-url">Your calendar link</label>
            <input id="ical-feed-url" type="text" readOnly value={feed.url} onFocus={(e) => e.currentTarget.select()} />
          </div>
          <div className="actions-row">
            <button type="button" className="button button-secondary" onClick={() => void handleCopy()}>
              Copy link
            </button>
            <a className="button button-secondary" href={feed.webcalUrl}>
              Open in Apple Calendar
            </a>
          </div>
          <p className="muted">
            Google Calendar: Other calendars → + → From URL, then paste the link above.
          </p>
          <div className="actions-row">
            <button type="button" className="button button-secondary" onClick={() => setConfirming('reset')}>
              Reset link
            </button>
            <button type="button" className="button button-danger" onClick={() => setConfirming('remove')}>
              Remove link
            </button>
          </div>
        </div>
      )}

      {confirming === 'reset' && (
        <ConfirmDialog
          title="Reset your calendar link?"
          body="Your current subscription will stop working — you'll need to re-subscribe with the new link."
          confirmLabel="Reset link"
          busy={confirmBusy}
          error={confirmError}
          onConfirm={() => void handleConfirm()}
          onClose={() => setConfirming(null)}
        />
      )}

      {confirming === 'remove' && (
        <ConfirmDialog
          title="Remove your calendar link?"
          body="Your current subscription will stop working. You can create a new one at any time."
          confirmLabel="Remove link"
          danger
          busy={confirmBusy}
          error={confirmError}
          onConfirm={() => void handleConfirm()}
          onClose={() => setConfirming(null)}
        />
      )}
    </div>
  );
}

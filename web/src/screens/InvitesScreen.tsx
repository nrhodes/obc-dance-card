/**
 * Invites inbox (`/invites`, plan Phase 3b task, deliverable 2). Incoming
 * pending invites (Accept/Decline), outgoing pending invites (Withdraw), and
 * the last 10 resolved invites, read-only. Every mutation goes through
 * `respondToInvite` / `cancelInvite` (plan §3: no client Firestore writes).
 */
import { useState } from 'react';
import type { Invite, Session } from '@obc/shared';
import { useInvites } from '../invites/useInvites';
import { useMembersDirectory } from '../members/useMembersDirectory';
import { useProgramme } from '../programme/useProgramme';
import { cancelInvite, respondToInvite } from '../api';
import { mapActionError } from '../lib/actionErrors';
import type { AppError } from '../firebase';
import { formatDateNZ, formatDateTimeNZ } from '../lib/format';

function scopeLabel(invite: Invite): string {
  if (invite.scope === 'series') {
    const n = invite.sessionIds.length;
    return `whole series: ${n} session${n === 1 ? '' : 's'}`;
  }
  return 'single session';
}

function datesLabel(invite: Invite, sessions: Session[]): string {
  const dates = invite.sessionIds
    .map((sid) => sessions.find((s) => s.id === sid)?.date)
    .filter((d): d is string => !!d)
    .sort();
  return dates.map(formatDateNZ).join(', ');
}

export function InvitesScreen() {
  const { incoming, outgoing, resolved, loading } = useInvites();
  const { nameOf } = useMembersDirectory();
  const { sessions } = useProgramme();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  function setError(id: string, message: string | null) {
    setErrorById((prev) => {
      const next = { ...prev };
      if (message == null) delete next[id];
      else next[id] = message;
      return next;
    });
  }

  async function handleAccept(invite: Invite) {
    setBusyId(invite.id);
    setError(invite.id, null);
    setNotice(null);
    try {
      const result = await respondToInvite({ inviteId: invite.id, accept: true });
      if (result.repeatPartnerWarning) {
        setNotice(`You've already played with ${nameOf(invite.fromMemberId)} in this individual series.`);
      }
    } catch (err) {
      setError(invite.id, mapActionError(err as AppError));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDecline(invite: Invite) {
    setBusyId(invite.id);
    setError(invite.id, null);
    setNotice(null);
    try {
      await respondToInvite({ inviteId: invite.id, accept: false });
    } catch (err) {
      setError(invite.id, mapActionError(err as AppError));
    } finally {
      setBusyId(null);
    }
  }

  async function handleWithdraw(invite: Invite) {
    setBusyId(invite.id);
    setError(invite.id, null);
    setNotice(null);
    try {
      await cancelInvite({ inviteId: invite.id });
    } catch (err) {
      setError(invite.id, mapActionError(err as AppError));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <h1>Invites</h1>
      </div>

      {notice && (
        <div className="card alert-success" role="status">
          {notice}
        </div>
      )}

      <div className="card">
        <h2>Incoming</h2>
        {loading && <p>Loading…</p>}
        {!loading && incoming.length === 0 && <p className="muted">No invites waiting for you.</p>}
        {!loading &&
          incoming.map((invite) => (
            <div key={invite.id} className="card">
              <p>
                <strong>{nameOf(invite.fromMemberId)}</strong> invited you &mdash; {scopeLabel(invite)}
              </p>
              <p className="muted">{datesLabel(invite, sessions)}</p>
              {invite.message && <p>&ldquo;{invite.message}&rdquo;</p>}
              <p className="muted">Expires {formatDateTimeNZ(invite.expiresAt)}</p>
              {errorById[invite.id] && (
                <div className="alert alert-error" role="alert">
                  {errorById[invite.id]}
                </div>
              )}
              <div className="actions-row">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={busyId === invite.id}
                  onClick={() => void handleAccept(invite)}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busyId === invite.id}
                  onClick={() => void handleDecline(invite)}
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
      </div>

      <div className="card">
        <h2>Sent</h2>
        {!loading && outgoing.length === 0 && <p className="muted">You have no pending invites out.</p>}
        {!loading &&
          outgoing.map((invite) => (
            <div key={invite.id} className="card">
              <p>
                Invited <strong>{nameOf(invite.toMemberId)}</strong> &mdash; {scopeLabel(invite)}
              </p>
              <p className="muted">{datesLabel(invite, sessions)}</p>
              {errorById[invite.id] && (
                <div className="alert alert-error" role="alert">
                  {errorById[invite.id]}
                </div>
              )}
              <div className="actions-row">
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busyId === invite.id}
                  onClick={() => void handleWithdraw(invite)}
                >
                  Withdraw
                </button>
              </div>
            </div>
          ))}
      </div>

      <div className="card">
        <h2>Recently resolved</h2>
        {!loading && resolved.length === 0 && <p className="muted">Nothing yet.</p>}
        {!loading && resolved.length > 0 && (
          <ul className="roster-list">
            {resolved.map((invite) => (
              <li key={invite.id}>
                {nameOf(invite.fromMemberId)} &amp; {nameOf(invite.toMemberId)} &mdash; {scopeLabel(invite)} &mdash;{' '}
                <strong>{invite.status}</strong>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

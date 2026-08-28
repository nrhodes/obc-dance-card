/**
 * Session page (`/session/:year/:sessionId`, plan Phase 3b task, §5.6, §6,
 * §9.2, §9.3, §12A.1). "Who's playing" is rendered from `entries` and (for a
 * Teams series) `teams`, as in Phase 2b; every action button now calls a
 * real callable (plan §3: clients never write Firestore — every mutation
 * here goes through `sendInvite` / `respondToInvite` / `setSoloStatus` /
 * `clearSoloStatus` / `claimLookingForPartner` / `cancelEntry`). Visitor
 * sign-up, substitutes, and teams actions remain disabled placeholders
 * (Phase 4 / 4b).
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { paths, sessionCutoff, type Entry, type Team } from '@obc/shared';
import { db } from '../firebase';
import type { AppError } from '../firebase';
import { useAuth } from '../auth/useAuth';
import { useProgramme } from '../programme/useProgramme';
import { useMembersDirectory } from '../members/useMembersDirectory';
import { formatDateNZ, formatTimeOfDay } from '../lib/format';
import { buildSessionRoster, describeOwnEntry, noticeboardLabels, teamMemberName, type SoloRow } from '../lib/roster';
import { deriveSessionActions, describeCancelConsequence } from '../lib/sessionActions';
import { mapActionError } from '../lib/actionErrors';
import { cancelEntry, claimLookingForPartner, clearSoloStatus, sendInvite, setSoloStatus } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { InvitePartnerDialog } from '../components/InvitePartnerDialog';
import { SoloStatusDialog } from '../components/SoloStatusDialog';

interface InviteDialogState {
  initialMemberId: string | null;
}

interface ClaimTarget {
  memberId: string;
  name: string;
}

export function SessionScreen() {
  const { year: yearParam, sessionId } = useParams<{ year: string; sessionId: string }>();
  const year = Number(yearParam);
  const { sessions, series, weekdays, loading: programmeLoading } = useProgramme(year);
  const { member } = useAuth();
  const { members, nameOf } = useMembersDirectory();

  const session = sessions.find((s) => s.id === sessionId);
  const seriesDoc = session?.seriesId ? series.find((s) => s.id === session.seriesId) : undefined;
  const weekdayDoc = session ? weekdays.find((w) => w.weekday === session.weekday) : undefined;
  const isTeamsSeries = seriesDoc?.format === 'Teams';

  const [entries, setEntries] = useState<Entry[]>([]);
  const [entriesLoaded, setEntriesLoaded] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    setEntriesLoaded(false);
    const q = query(collection(db, paths.entries()), where('sessionId', '==', sessionId));
    return onSnapshot(
      q,
      (snap) => {
        setEntries(snap.docs.map((d) => d.data() as Entry));
        setEntriesLoaded(true);
      },
      () => {
        setEntries([]);
        setEntriesLoaded(true);
      },
    );
  }, [sessionId]);

  const [teams, setTeams] = useState<Team[]>([]);
  const [teamsLoaded, setTeamsLoaded] = useState(true);

  useEffect(() => {
    if (!seriesDoc || seriesDoc.format !== 'Teams') {
      setTeams([]);
      setTeamsLoaded(true);
      return;
    }
    setTeamsLoaded(false);
    const q = query(collection(db, paths.teams()), where('seriesId', '==', seriesDoc.id));
    return onSnapshot(
      q,
      (snap) => {
        setTeams(snap.docs.map((d) => d.data() as Team));
        setTeamsLoaded(true);
      },
      () => {
        setTeams([]);
        setTeamsLoaded(true);
      },
    );
  }, [seriesDoc]);

  // ---- action dialogs / in-flight state ----
  const [notice, setNotice] = useState<string | null>(null);

  const [inviteDialog, setInviteDialog] = useState<InviteDialogState | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [claimTarget, setClaimTarget] = useState<ClaimTarget | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const [soloDialogStatus, setSoloDialogStatus] = useState<'looking_for_partner' | 'available' | null>(null);
  const [soloBusy, setSoloBusy] = useState(false);
  const [soloError, setSoloError] = useState<string | null>(null);

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  if (programmeLoading || !entriesLoaded || !teamsLoaded) {
    return (
      <div className="card">
        <p>Loading…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="card">
        <h1>Session not found</h1>
        <p>
          <Link to="/programme">Back to the programme</Link>
        </p>
      </div>
    );
  }

  if (session.kind === 'noBridge') {
    return (
      <div className="stack">
        <div className="card">
          <h1>{formatDateNZ(session.date)}</h1>
          <p>No bridge on this date.</p>
          {session.title && <p className="muted">{session.title}</p>}
          <p>
            <Link to="/programme">Back to the programme</Link>
          </p>
        </div>
      </div>
    );
  }

  const locked = weekdayDoc ? new Date() >= sessionCutoff(session.date, weekdayDoc.startTime) : false;
  const ownEntry = member ? entries.find((e) => e.memberId === member.id) : undefined;
  const ownSummary = ownEntry ? describeOwnEntry(ownEntry, teams) : null;

  const roster = buildSessionRoster(entries, nameOf);
  const labels = noticeboardLabels(seriesDoc?.format);
  const nobodySignedUp =
    roster.pairs.length === 0 && roster.lookingForPartner.length === 0 && roster.available.length === 0 && teams.length === 0;

  const actions = weekdayDoc ? deriveSessionActions(ownEntry ?? null, session, weekdayDoc, roster, new Date()) : null;

  const confirmedMemberIds = new Set<string>();
  for (const pair of roster.pairs) {
    confirmedMemberIds.add(pair.aMemberId);
    if (pair.bMemberId) confirmedMemberIds.add(pair.bMemberId);
  }

  function clearAllErrors() {
    setNotice(null);
  }

  async function handleSendInvite(input: { toMemberId: string; message?: string; scope: 'session' | 'series' }) {
    if (!session) return;
    setInviteBusy(true);
    setInviteError(null);
    try {
      // `httpsCallable` serialises `undefined` fields as `null`, which the
      // server's zod schema (`.optional()` string ids) rejects — only ever
      // include the key that applies to this invite's scope, and omit
      // `message` entirely rather than send it as `undefined`.
      await sendInvite({
        scope: input.scope,
        year,
        toMemberId: input.toMemberId,
        ...(input.scope === 'session' ? { sessionId: session.id } : {}),
        ...(input.scope === 'series' && session.seriesId ? { seriesId: session.seriesId } : {}),
        ...(input.message ? { message: input.message } : {}),
      });
      setInviteDialog(null);
      setNotice('Invite sent.');
    } catch (err) {
      setInviteError(mapActionError(err as AppError));
    } finally {
      setInviteBusy(false);
    }
  }

  async function handleConfirmClaim() {
    if (!claimTarget || !session) return;
    setClaimBusy(true);
    setClaimError(null);
    try {
      const result = await claimLookingForPartner({ year, sessionId: session.id, posterMemberId: claimTarget.memberId });
      setClaimTarget(null);
      setNotice(
        result.repeatPartnerWarning
          ? `You've already played with ${claimTarget.name} in this individual series.`
          : `You're now playing with ${claimTarget.name}.`,
      );
    } catch (err) {
      setClaimError(mapActionError(err as AppError));
    } finally {
      setClaimBusy(false);
    }
  }

  async function handleSetSolo(status: 'looking_for_partner' | 'available', note: string | undefined) {
    if (!session) return;
    setSoloBusy(true);
    setSoloError(null);
    try {
      // `httpsCallable` serialises `undefined` fields as `null`, which the
      // server's zod schema (an `.optional()` string) rejects — omit the key
      // entirely rather than send `note: undefined`.
      await setSoloStatus({ year, sessionId: session.id, status, ...(note ? { note } : {}) });
      setSoloDialogStatus(null);
      setNotice(status === 'looking_for_partner' ? "You're now looking for a partner." : "You're now marked as available.");
    } catch (err) {
      setSoloError(mapActionError(err as AppError));
    } finally {
      setSoloBusy(false);
    }
  }

  async function handleChangeSolo(newStatus: 'looking_for_partner' | 'available') {
    if (!session || !ownEntry) return;
    setSoloBusy(true);
    setSoloError(null);
    try {
      await clearSoloStatus({ year, sessionId: session.id });
      await setSoloStatus({ year, sessionId: session.id, status: newStatus, ...(ownEntry.note ? { note: ownEntry.note } : {}) });
      setNotice(newStatus === 'looking_for_partner' ? "You're now looking for a partner." : "You're now marked as available.");
    } catch (err) {
      setSoloError(mapActionError(err as AppError));
    } finally {
      setSoloBusy(false);
    }
  }

  async function handleRemoveSolo() {
    if (!session) return;
    setSoloBusy(true);
    setSoloError(null);
    try {
      await clearSoloStatus({ year, sessionId: session.id });
      setNotice('Removed from the noticeboard.');
    } catch (err) {
      setSoloError(mapActionError(err as AppError));
    } finally {
      setSoloBusy(false);
    }
  }

  async function handleCancelEntry() {
    if (!ownEntry) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      await cancelEntry({ entryId: ownEntry.id });
      setCancelDialogOpen(false);
      setNotice('Your entry for this session has been cancelled.');
    } catch (err) {
      setCancelError(mapActionError(err as AppError));
    } finally {
      setCancelBusy(false);
    }
  }

  function claimLabelFor(row: SoloRow): string | null {
    if (!actions || !actions.claimableMemberIds.includes(row.memberId)) return null;
    return `Play with ${row.name}`;
  }

  function inviteLabelFor(row: SoloRow): string | null {
    if (!actions || !actions.inviteableMemberIds.includes(row.memberId)) return null;
    return `Invite ${row.name}`;
  }

  return (
    <div className="stack">
      <div className="card">
        <h1>{session.title}</h1>
        <p>
          {weekdayDoc?.label ?? session.weekday} &middot; {formatDateNZ(session.date)}
        </p>
        {weekdayDoc && (
          <p>
            Starts {formatTimeOfDay(weekdayDoc.startTime)} &middot; seated by {formatTimeOfDay(weekdayDoc.seatedByTime)}
          </p>
        )}
        <p className="badges">
          {session.scoring && <span className="badge">{session.scoring}</span>}
          {session.format && <span className="badge">{session.format}</span>}
        </p>
        {weekdayDoc?.notes && <p className="muted">{weekdayDoc.notes}</p>}
        {seriesDoc?.eligibilityNote && <p className="muted">{seriesDoc.eligibilityNote}</p>}
        {seriesDoc?.generalNote && <p className="muted">{seriesDoc.generalNote}</p>}
        {locked && (
          <div className="alert alert-error" role="status">
            This session has started or finished.
          </div>
        )}
      </div>

      {ownSummary && (
        <div className="card alert-success" role="status">
          {ownSummary}
        </div>
      )}

      {notice && (
        <div className="card alert-success" role="status">
          {notice}
        </div>
      )}

      <div className="card">
        <h2>Who&apos;s playing</h2>

        {nobodySignedUp && <p className="muted">Nobody has signed up yet.</p>}

        {!isTeamsSeries && roster.pairs.length > 0 && (
          <ul className="roster-list">
            {roster.pairs.map((pair) => (
              <li key={pair.pairingId}>
                {pair.aName} &amp; {pair.bName}
                {pair.isVisitor && ' (visitor)'}
                {pair.substitute && ` (sub: ${pair.substitute.name} for ${pair.substitute.coveredName})`}
              </li>
            ))}
          </ul>
        )}

        {isTeamsSeries && teams.length > 0 && (
          <div className="stack">
            {teams.map((team) => (
              <div key={team.id} className="card team-card">
                <h3>{team.name}</h3>
                <p className="muted">
                  Captain: {nameOf(team.captainMemberId)} &middot; {team.status}
                </p>
                <ul>
                  {team.members.map((m, i) => (
                    <li key={i}>
                      {teamMemberName(m.ref)}
                      {m.ref.kind === 'visitor' && ' (visitor)'}
                      {m.ref.kind === 'member' && m.ref.memberId === team.captainMemberId && ' (captain)'}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {roster.lookingForPartner.length > 0 && (
          <NoticeboardList
            title={labels.lfp}
            rows={roster.lookingForPartner}
            actionLabel={claimLabelFor}
            onAction={(row) => {
              clearAllErrors();
              setClaimTarget({ memberId: row.memberId, name: row.name });
            }}
          />
        )}
        {roster.available.length > 0 && (
          <NoticeboardList
            title={labels.available}
            rows={roster.available}
            actionLabel={inviteLabelFor}
            onAction={(row) => {
              clearAllErrors();
              setInviteDialog({ initialMemberId: row.memberId });
            }}
          />
        )}
      </div>

      {actions && (
        <div className="card">
          <h2>Actions</h2>
          <ActionsPanel
            actions={actions}
            ownEntry={ownEntry}
            nameOf={nameOf}
            onInvite={() => {
              clearAllErrors();
              setInviteDialog({ initialMemberId: null });
            }}
            onSolo={(status) => {
              clearAllErrors();
              setSoloDialogStatus(status);
            }}
            onChangeSolo={(status) => void handleChangeSolo(status)}
            onRemoveSolo={() => void handleRemoveSolo()}
            onCancel={() => {
              clearAllErrors();
              setCancelDialogOpen(true);
            }}
          />
        </div>
      )}

      {inviteDialog && (
        <InvitePartnerDialog
          members={members}
          selfId={member?.id ?? ''}
          excludeMemberIds={confirmedMemberIds}
          seriesSessionCount={seriesDoc?.sessionIds.length}
          initialMemberId={inviteDialog.initialMemberId}
          busy={inviteBusy}
          error={inviteError}
          onClose={() => setInviteDialog(null)}
          onSubmit={(input) => void handleSendInvite(input)}
        />
      )}

      {claimTarget && (
        <ConfirmDialog
          title="Play with this partner?"
          body={`You'll be paired with ${claimTarget.name} for this session.`}
          confirmLabel="Play with them"
          busy={claimBusy}
          error={claimError}
          onConfirm={() => void handleConfirmClaim()}
          onClose={() => setClaimTarget(null)}
        />
      )}

      {soloDialogStatus && (
        <SoloStatusDialog
          status={soloDialogStatus}
          busy={soloBusy}
          error={soloError}
          onClose={() => setSoloDialogStatus(null)}
          onSubmit={(note) => void handleSetSolo(soloDialogStatus, note)}
        />
      )}

      {cancelDialogOpen && ownEntry && (
        <ConfirmDialog
          title="Cancel this session?"
          body={describeCancelConsequence(ownEntry)}
          confirmLabel="Cancel this session"
          danger
          busy={cancelBusy}
          error={cancelError}
          onConfirm={() => void handleCancelEntry()}
          onClose={() => setCancelDialogOpen(false)}
        />
      )}
    </div>
  );
}

function NoticeboardList({
  title,
  rows,
  actionLabel,
  onAction,
}: {
  title: string;
  rows: SoloRow[];
  actionLabel: (row: SoloRow) => string | null;
  onAction: (row: SoloRow) => void;
}) {
  return (
    <div>
      <h3>{title}</h3>
      <ul className="roster-list">
        {rows.map((row) => {
          const label = actionLabel(row);
          return (
            <li key={row.memberId}>
              {row.name}
              {row.note && ` — ${row.note}`}
              {label && (
                <>
                  {' '}
                  <button type="button" className="button button-secondary" onClick={() => onAction(row)}>
                    {label}
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ActionsPanel({
  actions,
  ownEntry,
  nameOf,
  onInvite,
  onSolo,
  onChangeSolo,
  onRemoveSolo,
  onCancel,
}: {
  actions: ReturnType<typeof deriveSessionActions>;
  ownEntry: Entry | undefined;
  nameOf: (memberId: string) => string;
  onInvite: () => void;
  onSolo: (status: 'looking_for_partner' | 'available') => void;
  onChangeSolo: (status: 'looking_for_partner' | 'available') => void;
  onRemoveSolo: () => void;
  onCancel: () => void;
}) {
  const { state } = actions;

  if (state.kind === 'locked') {
    return <p>This session has started.</p>;
  }

  if (state.kind === 'teamsFormat') {
    return (
      <div>
        <p>This is a teams event.</p>
        <div className="actions-row">
          <button type="button" className="button button-primary" disabled title="Coming in a future update">
            Start or join a team
          </button>
        </div>
      </div>
    );
  }

  if (state.kind === 'noEntryOpen') {
    return (
      <div className="actions-row">
        <button type="button" className="button button-primary" onClick={onInvite}>
          Invite a partner
        </button>
        <button type="button" className="button button-secondary" onClick={() => onSolo('looking_for_partner')}>
          I&apos;m looking for a partner
        </button>
        <button type="button" className="button button-secondary" onClick={() => onSolo('available')}>
          I&apos;m available
        </button>
        <button type="button" className="button button-secondary" disabled title="Coming soon">
          Play with a visitor
        </button>
      </div>
    );
  }

  if (state.kind === 'solo') {
    const other = state.status === 'looking_for_partner' ? 'available' : 'looking_for_partner';
    const otherLabel = other === 'available' ? 'Switch to available' : 'Switch to looking for a partner';
    return (
      <div className="actions-row">
        <button type="button" className="button button-secondary" onClick={() => onChangeSolo(other)}>
          {otherLabel}
        </button>
        <button type="button" className="button button-danger" onClick={onRemoveSolo}>
          Remove
        </button>
      </div>
    );
  }

  if (state.kind === 'confirmed' || state.kind === 'substituted') {
    return (
      <div className="actions-row">
        <button type="button" className="button button-danger" onClick={onCancel}>
          Cancel this session
        </button>
        {state.kind === 'confirmed' && (
          <button type="button" className="button button-secondary" disabled title="Coming soon">
            Arrange a substitute
          </button>
        )}
      </div>
    );
  }

  if (state.kind === 'sub') {
    return (
      <div>
        <p>You&apos;re standing in this week for {nameOf(state.isSubstituteFor)}.</p>
        <div className="actions-row">
          <button type="button" className="button button-danger" onClick={onCancel} disabled={!ownEntry}>
            Cancel this stand-in
          </button>
        </div>
      </div>
    );
  }

  return null;
}

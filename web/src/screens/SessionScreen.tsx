/**
 * Session page (`/session/:year/:sessionId`, plan Phase 3b task, extended
 * Phase 4c for visitors/substitutes/teams; §5.6, §6, §9.2, §9.3, §12, §12A).
 * "Who's playing" is rendered from `entries` and (for a Teams series)
 * `teams`; every action button calls a real callable (plan §3: clients
 * never write Firestore — every mutation here goes through a typed binding
 * in `../api`).
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { paths, sessionCutoff, type Entry } from '@obc/shared';
import { db } from '../firebase';
import type { AppError } from '../firebase';
import { useAuth } from '../auth/useAuth';
import { useEffectiveMember } from '../admin/useEffectiveMember';
import { useProgramme } from '../programme/useProgramme';
import { useMembersDirectory } from '../members/useMembersDirectory';
import { useVisitors } from '../visitors/useVisitors';
import { useTeams } from '../teams/useTeams';
import { formatDateNZ, formatTimeOfDay } from '../lib/format';
import { buildSessionRoster, describeOwnEntry, noticeboardLabels, teamMemberName, type SoloRow } from '../lib/roster';
import { buildTeamSessionView } from '../lib/team';
import { deriveSessionActions, describeCancelConsequence, type OwnEntryActionState } from '../lib/sessionActions';
import { filterPickableMembers } from '../lib/memberPicker';
import { mapActionError } from '../lib/actionErrors';
import { SubscriptionError } from '../components/SubscriptionError';
import {
  cancelEntry,
  claimLookingForPartner,
  clearSoloStatus,
  clearSubstitute,
  createVisitor,
  inviteToTeam,
  sendInvite,
  setSoloStatus,
  setSubstitute,
  signUpWithVisitor,
} from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { InvitePartnerDialog } from '../components/InvitePartnerDialog';
import { SoloStatusDialog } from '../components/SoloStatusDialog';
import { VisitorPickerDialog } from '../components/VisitorPickerDialog';
import { SubstituteDialog } from '../components/SubstituteDialog';
import type { PartnerRefInput } from '../components/PartnerPickerDialog';
import { TeamPanel } from '../components/TeamPanel';
import type { VisitorFormValues } from '../components/VisitorForm';

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
  // Plan Phase 6b task deliverable 2: while an admin is acting on behalf of
  // a member, every action on this page targets that member instead of the
  // signed-in admin, and this page's roster/"own entry" reads as them too.
  const { effectiveMemberId, onBehalfOfMemberId, actingAsName } = useEffectiveMember();
  const { members, byId, nameOf } = useMembersDirectory();
  const { visitors } = useVisitors();
  const teamsCtx = useTeams();
  const effectiveMember = effectiveMemberId
    ? (byId.get(effectiveMemberId) ?? (member && effectiveMemberId === member.id ? member : null))
    : null;
  const [force, setForce] = useState(false);

  const session = sessions.find((s) => s.id === sessionId);
  const seriesDoc = session?.seriesId ? series.find((s) => s.id === session.seriesId) : undefined;
  const weekdayDoc = session ? weekdays.find((w) => w.weekday === session.weekday) : undefined;
  const isTeamsSeries = seriesDoc?.format === 'Teams';

  const [entries, setEntries] = useState<Entry[]>([]);
  const [entriesLoaded, setEntriesLoaded] = useState(false);
  const [entriesError, setEntriesError] = useState<{ code: string } | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    setEntriesLoaded(false);
    const q = query(collection(db, paths.entries()), where('sessionId', '==', sessionId));
    return onSnapshot(
      q,
      (snap) => {
        setEntries(snap.docs.map((d) => d.data() as Entry));
        setEntriesError(null);
        setEntriesLoaded(true);
      },
      (err) => {
        console.error('subscription_failed', 'session_entries', err.code);
        setEntries([]);
        setEntriesError({ code: err.code });
        setEntriesLoaded(true);
      },
    );
  }, [sessionId]);

  const seriesTeams = seriesDoc ? teamsCtx.teamsForSeries(seriesDoc.id) : [];
  const myTeam = seriesDoc ? teamsCtx.myTeamForSeries(seriesDoc.id) : null;
  const otherTeams = seriesTeams.filter((t) => t.id !== myTeam?.id);
  const hasAbsence = myTeam && session ? buildTeamSessionView(myTeam, entries, session.id).hasAbsence : false;

  // ---- action dialogs / in-flight state ----
  const [notice, setNotice] = useState<string | null>(null);

  const [inviteDialog, setInviteDialog] = useState<InviteDialogState | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [teamInviteTarget, setTeamInviteTarget] = useState<ClaimTarget | null>(null);
  const [teamInviteBusy, setTeamInviteBusy] = useState(false);
  const [teamInviteError, setTeamInviteError] = useState<string | null>(null);

  const [claimTarget, setClaimTarget] = useState<ClaimTarget | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const [soloDialogStatus, setSoloDialogStatus] = useState<'looking_for_partner' | 'available' | null>(null);
  const [soloBusy, setSoloBusy] = useState(false);
  const [soloError, setSoloError] = useState<string | null>(null);

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const [visitorDialogOpen, setVisitorDialogOpen] = useState(false);
  const [visitorBusy, setVisitorBusy] = useState(false);
  const [visitorError, setVisitorError] = useState<string | null>(null);

  const [substituteDialogOpen, setSubstituteDialogOpen] = useState(false);
  const [substituteBusy, setSubstituteBusy] = useState(false);
  const [substituteError, setSubstituteError] = useState<string | null>(null);

  const [removeSubOpen, setRemoveSubOpen] = useState(false);
  const [removeSubBusy, setRemoveSubBusy] = useState(false);
  const [removeSubError, setRemoveSubError] = useState<string | null>(null);

  if (programmeLoading || !entriesLoaded || teamsCtx.loading) {
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
  const ownEntry = effectiveMemberId ? entries.find((e) => e.memberId === effectiveMemberId) : undefined;
  const ownSummary = ownEntry ? describeOwnEntry(ownEntry, seriesTeams) : null;

  const roster = buildSessionRoster(entries, nameOf);
  const labels = noticeboardLabels(seriesDoc?.format);
  const nobodySignedUp =
    roster.pairs.length === 0 &&
    roster.lookingForPartner.length === 0 &&
    roster.available.length === 0 &&
    seriesTeams.length === 0;

  const actions = weekdayDoc
    ? deriveSessionActions(ownEntry ?? null, session, weekdayDoc, roster, new Date(), {
        series: seriesDoc ?? null,
        team: myTeam,
        actorMemberId: effectiveMemberId,
        hasAbsence,
      })
    : null;

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
        ...(onBehalfOfMemberId ? { onBehalfOfMemberId } : {}),
      });
      setInviteDialog(null);
      setNotice('Invite sent.');
    } catch (err) {
      setInviteError(mapActionError(err as AppError));
    } finally {
      setInviteBusy(false);
    }
  }

  async function handleConfirmTeamInvite() {
    if (!teamInviteTarget || !myTeam) return;
    setTeamInviteBusy(true);
    setTeamInviteError(null);
    try {
      await inviteToTeam({
        teamId: myTeam.id,
        toMemberId: teamInviteTarget.memberId,
        ...(onBehalfOfMemberId ? { onBehalfOfMemberId } : {}),
      });
      setTeamInviteTarget(null);
      setNotice(`Invited ${teamInviteTarget.name} to your team.`);
    } catch (err) {
      setTeamInviteError(mapActionError(err as AppError));
    } finally {
      setTeamInviteBusy(false);
    }
  }

  async function handleConfirmClaim() {
    if (!claimTarget || !session) return;
    setClaimBusy(true);
    setClaimError(null);
    try {
      const result = await claimLookingForPartner({
        year,
        sessionId: session.id,
        posterMemberId: claimTarget.memberId,
        ...(onBehalfOfMemberId ? { onBehalfOfMemberId } : {}),
        ...(force ? { force: true } : {}),
      });
      setClaimTarget(null);
      setForce(false);
      setNotice(
        result.team
          ? `${claimTarget.name} has joined your team.`
          : result.repeatPartnerWarning
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
      await setSoloStatus({
        year,
        sessionId: session.id,
        status,
        ...(note ? { note } : {}),
        ...(onBehalfOfMemberId ? { onBehalfOfMemberId } : {}),
      });
      setSoloDialogStatus(null);
      setNotice(
        isTeamsSeries
          ? status === 'looking_for_partner'
            ? "You're now looking for a team."
            : "You're now available for a team."
          : status === 'looking_for_partner'
            ? "You're now looking for a partner."
            : "You're now marked as available.",
      );
    } catch (err) {
      setSoloError(mapActionError(err as AppError));
    } finally {
      setSoloBusy(false);
    }
  }

  async function handleChangeSolo(newStatus: 'looking_for_partner' | 'available') {
    if (!session || !ownEntry) return;
    // `clearSoloStatus` deliberately has no `onBehalfOfMemberId` (plan §9.2
    // schema note) — it always acts on the caller, so this compound
    // clear-then-set can only ever be done as yourself. The buttons that
    // call this are hidden while acting on behalf (see `ActionsPanel`); this
    // guard is defence in depth against calling it anyway.
    if (onBehalfOfMemberId) return;
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
    if (onBehalfOfMemberId) return; // see handleChangeSolo
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
      await cancelEntry({
        entryId: ownEntry.id,
        ...(onBehalfOfMemberId ? { onBehalfOfMemberId } : {}),
        ...(force ? { force: true } : {}),
      });
      setCancelDialogOpen(false);
      setForce(false);
      setNotice('Your entry for this session has been cancelled.');
    } catch (err) {
      setCancelError(mapActionError(err as AppError));
    } finally {
      setCancelBusy(false);
    }
  }

  async function handleCreateVisitor(values: VisitorFormValues) {
    const result = await createVisitor({ ...values, ...(onBehalfOfMemberId ? { onBehalfOfMemberId } : {}) });
    return result.visitor;
  }

  async function handlePlayWithVisitor(visitorId: string, opts: { wholeSeries: boolean }) {
    if (!session) return;
    setVisitorBusy(true);
    setVisitorError(null);
    try {
      await signUpWithVisitor({
        scope: opts.wholeSeries ? 'series' : 'session',
        year,
        visitorId,
        ...(opts.wholeSeries && session.seriesId ? { seriesId: session.seriesId } : { sessionId: session.id }),
        ...(onBehalfOfMemberId ? { onBehalfOfMemberId } : {}),
      });
      setVisitorDialogOpen(false);
      setNotice('Signed up to play with your visitor.');
    } catch (err) {
      setVisitorError(mapActionError(err as AppError));
    } finally {
      setVisitorBusy(false);
    }
  }

  async function handleArrangeSubstitute(coverFor: 'self' | 'partner', substitute: PartnerRefInput) {
    if (!ownEntry) return;
    setSubstituteBusy(true);
    setSubstituteError(null);
    try {
      await setSubstitute({
        entryId: ownEntry.id,
        substitute,
        coverFor,
        ...(onBehalfOfMemberId ? { onBehalfOfMemberId } : {}),
      });
      setSubstituteDialogOpen(false);
      setNotice('Substitute arranged.');
    } catch (err) {
      setSubstituteError(mapActionError(err as AppError));
    } finally {
      setSubstituteBusy(false);
    }
  }

  async function handleRemoveSubstitute() {
    if (!ownEntry) return;
    setRemoveSubBusy(true);
    setRemoveSubError(null);
    try {
      await clearSubstitute({ entryId: ownEntry.id, ...(onBehalfOfMemberId ? { onBehalfOfMemberId } : {}) });
      setRemoveSubOpen(false);
      setNotice('Substitute removed.');
    } catch (err) {
      setRemoveSubError(mapActionError(err as AppError));
    } finally {
      setRemoveSubBusy(false);
    }
  }

  function claimLabelFor(row: SoloRow): string | null {
    if (!actions || !actions.claimableMemberIds.includes(row.memberId)) return null;
    return isTeamsSeries ? `Add ${row.name} to my team` : `Play with ${row.name}`;
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

      {entriesError && <SubscriptionError resource="who's playing" />}

      {actingAsName && (
        <div className="card muted" role="status">
          Showing {actingAsName}&apos;s card for this session.
        </div>
      )}

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

        {isTeamsSeries && seriesTeams.length > 0 && (
          <div className="stack">
            {seriesTeams.map((team) => (
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
              if (isTeamsSeries) {
                setTeamInviteTarget({ memberId: row.memberId, name: row.name });
              } else {
                setInviteDialog({ initialMemberId: row.memberId });
              }
            }}
          />
        )}
      </div>

      {actions && actions.state.kind === 'teamsFormat' && seriesDoc && effectiveMember && (
        <div className="card">
          <h2>Team</h2>
          <TeamPanel
            year={year}
            series={seriesDoc}
            session={session}
            role={actions.state.role}
            team={myTeam}
            otherTeams={otherTeams}
            sessionEntries={entries}
            member={effectiveMember}
            members={members}
            nameOf={nameOf}
            visitors={visitors}
            {...(onBehalfOfMemberId ? { onBehalfOfMemberId } : {})}
            disableSoloEdit={!!onBehalfOfMemberId}
            onNotice={setNotice}
            onSolo={(status) => {
              clearAllErrors();
              setSoloDialogStatus(status);
            }}
            onChangeSolo={(status) => void handleChangeSolo(status)}
            onRemoveSolo={() => void handleRemoveSolo()}
          />
        </div>
      )}

      {actions && actions.state.kind !== 'teamsFormat' && (
        <div className="card">
          <h2>Actions</h2>
          <ActionsPanel
            actions={actions}
            ownEntry={ownEntry}
            nameOf={nameOf}
            disableSoloEdit={!!onBehalfOfMemberId}
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
            onPlayWithVisitor={() => {
              clearAllErrors();
              setVisitorDialogOpen(true);
            }}
            onArrangeSubstitute={() => {
              clearAllErrors();
              setSubstituteDialogOpen(true);
            }}
            onRemoveSubstitute={() => {
              clearAllErrors();
              setRemoveSubOpen(true);
            }}
          />
        </div>
      )}

      {inviteDialog && (
        <InvitePartnerDialog
          members={members}
          selfId={effectiveMemberId ?? ''}
          excludeMemberIds={confirmedMemberIds}
          seriesSessionCount={seriesDoc?.sessionIds.length}
          initialMemberId={inviteDialog.initialMemberId}
          busy={inviteBusy}
          error={inviteError}
          onClose={() => setInviteDialog(null)}
          onSubmit={(input) => void handleSendInvite(input)}
        />
      )}

      {teamInviteTarget && (
        <ConfirmDialog
          title="Invite to your team?"
          body={`${teamInviteTarget.name} will be sent an invite to join your team.`}
          confirmLabel="Send invite"
          busy={teamInviteBusy}
          error={teamInviteError}
          onConfirm={() => void handleConfirmTeamInvite()}
          onClose={() => setTeamInviteTarget(null)}
        />
      )}

      {claimTarget && (
        <ConfirmDialog
          title={isTeamsSeries ? 'Add to your team?' : 'Play with this partner?'}
          body={
            isTeamsSeries
              ? `${claimTarget.name} will join your team for every remaining session in this series.`
              : `You'll be paired with ${claimTarget.name} for this session.`
          }
          confirmLabel={isTeamsSeries ? 'Add to my team' : 'Play with them'}
          busy={claimBusy}
          error={claimError}
          onConfirm={() => void handleConfirmClaim()}
          onClose={() => {
            setClaimTarget(null);
            setForce(false);
          }}
          {...(onBehalfOfMemberId ? { force, onForceChange: setForce } : {})}
        />
      )}

      {soloDialogStatus && (
        <SoloStatusDialog
          status={soloDialogStatus}
          entityLabel={isTeamsSeries ? 'team' : 'partner'}
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
          onClose={() => {
            setCancelDialogOpen(false);
            setForce(false);
          }}
          {...(onBehalfOfMemberId ? { force, onForceChange: setForce } : {})}
        />
      )}

      {visitorDialogOpen && (
        <VisitorPickerDialog
          title="Play with a visitor"
          visitors={visitors}
          seriesSessionCount={seriesDoc?.sessionIds.length}
          busy={visitorBusy}
          error={visitorError}
          onClose={() => setVisitorDialogOpen(false)}
          onSelect={(visitorId, opts) => void handlePlayWithVisitor(visitorId, opts)}
          onCreateVisitor={handleCreateVisitor}
        />
      )}

      {substituteDialogOpen && actions?.state.kind === 'confirmed' && (
        <SubstituteDialog
          partnerName={actions.state.partner.displayName}
          members={filterPickableMembers(members, { selfId: effectiveMemberId ?? '', excludeMemberIds: confirmedMemberIds, query: '' })}
          visitors={visitors}
          busy={substituteBusy}
          error={substituteError}
          onClose={() => setSubstituteDialogOpen(false)}
          onSubmit={(coverFor, substitute) => void handleArrangeSubstitute(coverFor, substitute)}
          onCreateVisitor={handleCreateVisitor}
        />
      )}

      {removeSubOpen && (
        <ConfirmDialog
          title="Remove this substitute?"
          body="The original pairing will be restored for this session."
          confirmLabel="Remove substitute"
          danger
          busy={removeSubBusy}
          error={removeSubError}
          onConfirm={() => void handleRemoveSubstitute()}
          onClose={() => setRemoveSubOpen(false)}
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
  disableSoloEdit,
  onInvite,
  onSolo,
  onChangeSolo,
  onRemoveSolo,
  onCancel,
  onPlayWithVisitor,
  onArrangeSubstitute,
  onRemoveSubstitute,
}: {
  actions: { state: OwnEntryActionState };
  ownEntry: Entry | undefined;
  nameOf: (memberId: string) => string;
  /** True while acting on behalf of another member: `clearSoloStatus` can only ever target the caller (plan §9.2), so switching/removing a noticeboard listing isn't offered here. */
  disableSoloEdit?: boolean;
  onInvite: () => void;
  onSolo: (status: 'looking_for_partner' | 'available') => void;
  onChangeSolo: (status: 'looking_for_partner' | 'available') => void;
  onRemoveSolo: () => void;
  onCancel: () => void;
  onPlayWithVisitor: () => void;
  onArrangeSubstitute: () => void;
  onRemoveSubstitute: () => void;
}) {
  const { state } = actions;

  if (state.kind === 'locked') {
    return <p>This session has started.</p>;
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
        <button type="button" className="button button-secondary" onClick={onPlayWithVisitor}>
          Play with a visitor
        </button>
      </div>
    );
  }

  if (state.kind === 'solo') {
    const other = state.status === 'looking_for_partner' ? 'available' : 'looking_for_partner';
    const otherLabel = other === 'available' ? 'Switch to available' : 'Switch to looking for a partner';
    if (disableSoloEdit) {
      return <p className="muted">Switching or removing a noticeboard listing isn&apos;t available while acting on behalf of another member.</p>;
    }
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
    const arranged =
      state.kind === 'substituted' ? state.substitute : state.substituteOption.kind === 'arranged' ? state.substituteOption.substitute : null;
    return (
      <div className="stack">
        {arranged && (
          <p>
            {arranged.displayName} is standing in {state.kind === 'substituted' ? 'for you' : `for ${state.partner.displayName}`} this
            week.
          </p>
        )}
        {state.kind === 'confirmed' && state.substituteOption.kind === 'visitorPairing' && (
          <p className="muted">To change a visitor partner, cancel and sign up again.</p>
        )}
        {state.kind === 'confirmed' && state.substituteOption.kind === 'notAllowed' && (
          <p className="muted">This series does not allow substitutes.</p>
        )}
        <div className="actions-row">
          <button type="button" className="button button-danger" onClick={onCancel}>
            Cancel this session
          </button>
          {state.kind === 'confirmed' && state.substituteOption.kind === 'available' && (
            <button type="button" className="button button-secondary" onClick={onArrangeSubstitute}>
              Arrange a substitute
            </button>
          )}
          {(state.kind === 'substituted' || (state.kind === 'confirmed' && state.substituteOption.kind === 'arranged')) && (
            <button type="button" className="button button-secondary" onClick={onRemoveSubstitute}>
              Remove substitute
            </button>
          )}
        </div>
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

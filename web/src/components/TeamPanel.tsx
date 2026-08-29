/**
 * Team panel for a Teams-format series' session page (plan §12A, Phase 4c
 * task) — replaces the old "This is a teams event" placeholder. Renders one
 * of three views depending on `role` (from `deriveSessionActions`):
 *
 * - `notOnTeam`  — "Start a team", the noticeboard ("Looking for a team" /
 *   "Available for a team"), and a read-only list of the series' other teams.
 * - `member`     — the team's roster, this session's absences/substitutes,
 *   and "Leave team".
 * - `captain`    — the same roster/absence view plus every captain action:
 *   invite a member, add a visitor, remove a member/visitor, transfer
 *   captaincy, disband, and manage this session's substitute(s).
 *
 * Every mutation goes through a `teams` callable (plan §3/§9.2) — this
 * component owns its own dialog/busy/error state and reports successes via
 * `onNotice` so they land in the session page's one shared notice banner.
 */
import { useState } from 'react';
import type { Entry, Member, PartnerRef, Series, Session, Team, Visitor } from '@obc/shared';
import type { AppError } from '../firebase';
import type { TeamsRole } from '../lib/sessionActions';
import { buildTeamSessionView, teamStatusLabel } from '../lib/team';
import { filterPickableMembers } from '../lib/memberPicker';
import { mapActionError } from '../lib/actionErrors';
import {
  addTeamSessionSubstitute,
  addVisitorToTeam,
  clearTeamSessionSubstitute,
  createTeam,
  createVisitor,
  disbandTeam,
  inviteToTeam,
  leaveTeam,
  removeFromTeam,
  removeVisitorFromTeam,
  transferCaptaincy,
} from '../api';
import { ConfirmDialog } from './ConfirmDialog';
import { InviteToTeamDialog } from './InviteToTeamDialog';
import { VisitorPickerDialog } from './VisitorPickerDialog';
import { PartnerPickerDialog, type PartnerRefInput } from './PartnerPickerDialog';
import { TransferCaptaincyDialog } from './TransferCaptaincyDialog';
import { StartTeamDialog } from './StartTeamDialog';
import type { VisitorFormValues } from './VisitorForm';

type PanelDialog =
  | { kind: 'start' }
  | { kind: 'invite' }
  | { kind: 'addVisitor' }
  | { kind: 'removeMember'; memberId: string; name: string }
  | { kind: 'removeVisitor'; visitorId: string; name: string }
  | { kind: 'transferCaptaincy' }
  | { kind: 'disband' }
  | { kind: 'leave' }
  | { kind: 'addSessionSub' }
  | { kind: 'removeSessionSub'; ref: PartnerRefInput; name: string };

export interface TeamPanelProps {
  year: number;
  series: Series;
  session: Session;
  role: TeamsRole;
  /** The signed-in member's team for this series, or null when `role.kind === 'notOnTeam'`. */
  team: Team | null;
  /** Every other forming/active team in this series (read-only display when not on one). */
  otherTeams: Team[];
  /** Entries for *this* session only (used to work out who's absent and who's standing in). */
  sessionEntries: Entry[];
  member: Member;
  members: Member[];
  nameOf: (memberId: string) => string;
  visitors: Visitor[];
  onNotice: (message: string) => void;
  onSolo: (status: 'looking_for_partner' | 'available') => void;
  onChangeSolo: (status: 'looking_for_partner' | 'available') => void;
  onRemoveSolo: () => void;
}

export function TeamPanel({
  year,
  series,
  session,
  role,
  team,
  otherTeams,
  sessionEntries,
  member,
  members,
  nameOf,
  visitors,
  onNotice,
  onSolo,
  onChangeSolo,
  onRemoveSolo,
}: TeamPanelProps) {
  const [dialog, setDialog] = useState<PanelDialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setDialog(null);
    setError(null);
  }

  async function run(action: () => Promise<void>, successMessage?: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setDialog(null);
      if (successMessage) onNotice(successMessage);
    } catch (err) {
      setError(mapActionError(err as AppError));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateVisitor(values: VisitorFormValues): Promise<Visitor> {
    const result = await createVisitor(values);
    return result.visitor;
  }

  // ---------------------------- not on a team ----------------------------

  if (role.kind === 'notOnTeam') {
    return (
      <div className="stack">
        {role.solo ? (
          <div className="actions-row">
            <button
              type="button"
              className="button button-secondary"
              onClick={() =>
                onChangeSolo(role.solo!.status === 'looking_for_partner' ? 'available' : 'looking_for_partner')
              }
            >
              {role.solo.status === 'looking_for_partner' ? 'Switch to available for a team' : 'Switch to looking for a team'}
            </button>
            <button type="button" className="button button-danger" onClick={onRemoveSolo}>
              Remove
            </button>
          </div>
        ) : (
          <div className="actions-row">
            <button type="button" className="button button-primary" onClick={() => setDialog({ kind: 'start' })}>
              Start a team
            </button>
            <button type="button" className="button button-secondary" onClick={() => onSolo('looking_for_partner')}>
              I&apos;m looking for a team
            </button>
            <button type="button" className="button button-secondary" onClick={() => onSolo('available')}>
              I&apos;m available for a team
            </button>
          </div>
        )}

        {otherTeams.length > 0 && (
          <div>
            <h3>Other teams in this series</h3>
            <ul className="roster-list">
              {otherTeams.map((t) => (
                <li key={t.id}>
                  {t.name} &mdash; captain {nameOf(t.captainMemberId)} &middot; {t.members.length} member
                  {t.members.length === 1 ? '' : 's'} &middot; {t.status}
                </li>
              ))}
            </ul>
          </div>
        )}

        {dialog?.kind === 'start' && (
          <StartTeamDialog
            busy={busy}
            error={error}
            onClose={close}
            onSubmit={(name) =>
              void run(async () => {
                await createTeam({ year, seriesId: series.id, ...(name ? { name } : {}) });
              }, 'Team started.')
            }
          />
        )}
      </div>
    );
  }

  // ---------------------------- on a team ----------------------------

  if (!team) return null; // role is member/captain only when a team was found

  const view = buildTeamSessionView(team, sessionEntries, session.id);
  const isCaptain = role.kind === 'captain';
  const teamMemberIds = new Set(
    team.members.filter((m) => m.ref.kind === 'member').map((m) => (m.ref as Extract<PartnerRef, { kind: 'member' }>).memberId),
  );
  const invitableMembers = filterPickableMembers(members, { selfId: member.id, excludeMemberIds: teamMemberIds, query: '' });
  const subCandidateMembers = filterPickableMembers(members, { selfId: '', excludeMemberIds: teamMemberIds, query: '' });
  const otherTeamMembers = team.members
    .filter((m) => m.ref.kind === 'member' && m.ref.memberId !== team.captainMemberId)
    .map((m) => ({ memberId: (m.ref as { memberId: string }).memberId, name: m.ref.displayName }));

  return (
    <div className="stack">
      <div>
        <h3>{team.name}</h3>
        <p className="muted">
          {teamStatusLabel(team, series)} &middot; Captain: {nameOf(team.captainMemberId)}
        </p>
        <ul className="roster-list">
          {team.members.map((m, i) => {
            const ref = m.ref;
            const isMemberRef = ref.kind === 'member';
            const isCaptainRef = isMemberRef && ref.memberId === team.captainMemberId;
            return (
              <li key={i}>
                {ref.displayName}
                {ref.kind === 'visitor' && ' (visitor)'}
                {isCaptainRef && ' (captain)'}
                {isCaptain && isMemberRef && !isCaptainRef && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="button button-link"
                      onClick={() => setDialog({ kind: 'removeMember', memberId: ref.memberId, name: ref.displayName })}
                    >
                      Remove
                    </button>
                  </>
                )}
                {isCaptain && ref.kind === 'visitor' && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="button button-link"
                      onClick={() => setDialog({ kind: 'removeVisitor', visitorId: ref.visitorId, name: ref.displayName })}
                    >
                      Remove
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {(view.absentMemberIds.length > 0 || view.memberSubstitutes.length > 0 || view.visitorSubstitutes.length > 0) && (
        <div>
          <h4>This session</h4>
          {view.absentMemberIds.length > 0 && (
            <p className="muted">Absent: {view.absentMemberIds.map((id) => nameOf(id)).join(', ')}</p>
          )}
          {(view.memberSubstitutes.length > 0 || view.visitorSubstitutes.length > 0) && (
            <ul className="roster-list">
              {view.memberSubstitutes.map((e) => (
                <li key={e.id}>
                  Standing in: {nameOf(e.memberId)}
                  {isCaptain && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="button button-link"
                        onClick={() =>
                          setDialog({
                            kind: 'removeSessionSub',
                            ref: { kind: 'member', memberId: e.memberId },
                            name: nameOf(e.memberId),
                          })
                        }
                      >
                        Remove
                      </button>
                    </>
                  )}
                </li>
              ))}
              {view.visitorSubstitutes.map((ref) => (
                <li key={ref.kind === 'visitor' ? ref.visitorId : ref.displayName}>
                  Standing in: {ref.displayName} (visitor)
                  {isCaptain && ref.kind === 'visitor' && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="button button-link"
                        onClick={() =>
                          setDialog({
                            kind: 'removeSessionSub',
                            ref: { kind: 'visitor', visitorId: ref.visitorId },
                            name: ref.displayName,
                          })
                        }
                      >
                        Remove
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="actions-row">
        {!isCaptain && (
          <button type="button" className="button button-danger" onClick={() => setDialog({ kind: 'leave' })}>
            Leave team
          </button>
        )}
        {isCaptain && (
          <>
            <button type="button" className="button button-secondary" onClick={() => setDialog({ kind: 'invite' })}>
              Invite a member
            </button>
            <button type="button" className="button button-secondary" onClick={() => setDialog({ kind: 'addVisitor' })}>
              Add a visitor
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setDialog({ kind: 'addSessionSub' })}
              disabled={!role.hasAbsence}
              title={role.hasAbsence ? undefined : 'No rostered member is absent this session'}
            >
              Add a substitute for this session
            </button>
            <button type="button" className="button button-secondary" onClick={() => setDialog({ kind: 'transferCaptaincy' })}>
              Transfer captaincy
            </button>
            <button type="button" className="button button-danger" onClick={() => setDialog({ kind: 'disband' })}>
              Disband team
            </button>
          </>
        )}
      </div>
      {!isCaptain && <p className="muted">Captains must transfer the captaincy or disband before leaving.</p>}

      {dialog?.kind === 'leave' && (
        <ConfirmDialog
          title="Leave this team?"
          body="You'll be removed from the team roster and your future sessions in this series will be cancelled."
          confirmLabel="Leave team"
          danger
          busy={busy}
          error={error}
          onClose={close}
          onConfirm={() =>
            void run(async () => {
              await leaveTeam({ teamId: team.id });
            }, "You've left the team.")
          }
        />
      )}

      {dialog?.kind === 'invite' && (
        <InviteToTeamDialog
          members={invitableMembers}
          selfId={member.id}
          excludeMemberIds={teamMemberIds}
          busy={busy}
          error={error}
          onClose={close}
          onSubmit={(input) =>
            void run(async () => {
              await inviteToTeam({ teamId: team.id, ...input });
            }, 'Invite sent.')
          }
        />
      )}

      {dialog?.kind === 'addVisitor' && (
        <VisitorPickerDialog
          title="Add a visitor to the team"
          visitors={visitors}
          busy={busy}
          error={error}
          onClose={close}
          onSelect={(visitorId) =>
            void run(async () => {
              await addVisitorToTeam({ teamId: team.id, visitorId });
            }, 'Visitor added to the team.')
          }
          onCreateVisitor={handleCreateVisitor}
        />
      )}

      {dialog?.kind === 'removeMember' && (
        <ConfirmDialog
          title="Remove this member?"
          body={`${dialog.name} will be removed from the team and their future sessions in this series will be cancelled.`}
          confirmLabel="Remove"
          danger
          busy={busy}
          error={error}
          onClose={close}
          onConfirm={() =>
            void run(async () => {
              await removeFromTeam({ teamId: team.id, ref: { kind: 'member', memberId: dialog.memberId } });
            }, `${dialog.name} was removed from the team.`)
          }
        />
      )}

      {dialog?.kind === 'removeVisitor' && (
        <ConfirmDialog
          title="Remove this visitor?"
          body={`${dialog.name} will be removed from the team.`}
          confirmLabel="Remove"
          danger
          busy={busy}
          error={error}
          onClose={close}
          onConfirm={() =>
            void run(async () => {
              await removeVisitorFromTeam({ teamId: team.id, visitorId: dialog.visitorId });
            }, `${dialog.name} was removed from the team.`)
          }
        />
      )}

      {dialog?.kind === 'transferCaptaincy' && (
        <TransferCaptaincyDialog
          candidates={otherTeamMembers}
          busy={busy}
          error={error}
          onClose={close}
          onSubmit={(toMemberId) =>
            void run(async () => {
              await transferCaptaincy({ teamId: team.id, toMemberId });
            }, 'Captaincy offer sent.')
          }
        />
      )}

      {dialog?.kind === 'disband' && (
        <ConfirmDialog
          title="Disband this team?"
          body="Every team member's future sessions in this series will be cancelled and the team will close. This cannot be undone."
          confirmLabel="Disband team"
          danger
          busy={busy}
          error={error}
          onClose={close}
          onConfirm={() =>
            void run(async () => {
              await disbandTeam({ teamId: team.id });
            }, 'Team disbanded.')
          }
        />
      )}

      {dialog?.kind === 'addSessionSub' && (
        <PartnerPickerDialog
          title="Who will play this session?"
          members={subCandidateMembers}
          visitors={visitors}
          busy={busy}
          error={error}
          onClose={close}
          onSelectMember={(memberId) =>
            void run(async () => {
              await addTeamSessionSubstitute({ teamId: team.id, sessionId: session.id, ref: { kind: 'member', memberId } });
            }, 'Substitute added for this session.')
          }
          onSelectVisitor={(visitorId) =>
            void run(async () => {
              await addTeamSessionSubstitute({ teamId: team.id, sessionId: session.id, ref: { kind: 'visitor', visitorId } });
            }, 'Substitute added for this session.')
          }
          onCreateVisitor={handleCreateVisitor}
        />
      )}

      {dialog?.kind === 'removeSessionSub' && (
        <ConfirmDialog
          title="Remove this substitute?"
          body={`${dialog.name} will no longer be standing in for this session.`}
          confirmLabel="Remove"
          danger
          busy={busy}
          error={error}
          onClose={close}
          onConfirm={() =>
            void run(async () => {
              await clearTeamSessionSubstitute({ teamId: team.id, sessionId: session.id, ref: dialog.ref });
            }, 'Substitute removed.')
          }
        />
      )}
    </div>
  );
}

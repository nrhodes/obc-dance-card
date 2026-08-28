/**
 * Session page (`/session/:year/:sessionId`, plan Phase 2b task, §5.6, §6,
 * §12A.1). Read-only this phase: "who's playing" is rendered from `entries`
 * and (for a Teams series) `teams`, but every action is a disabled
 * placeholder — no writes happen from this screen (plan §3: clients never
 * write Firestore; the real actions are Phase 3/4 callables).
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { paths, sessionCutoff, type Entry, type Team } from '@obc/shared';
import { db } from '../firebase';
import { useAuth } from '../auth/useAuth';
import { useProgramme } from '../programme/useProgramme';
import { useMembersDirectory } from '../members/useMembersDirectory';
import { formatDateNZ, formatTimeOfDay } from '../lib/format';
import { buildSessionRoster, describeOwnEntry, noticeboardLabels, teamMemberName, type SoloRow } from '../lib/roster';

export function SessionScreen() {
  const { year: yearParam, sessionId } = useParams<{ year: string; sessionId: string }>();
  const year = Number(yearParam);
  const { sessions, series, weekdays, loading: programmeLoading } = useProgramme(year);
  const { member } = useAuth();
  const { nameOf } = useMembersDirectory();

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

        {roster.lookingForPartner.length > 0 && <NoticeboardList title={labels.lfp} rows={roster.lookingForPartner} />}
        {roster.available.length > 0 && <NoticeboardList title={labels.available} rows={roster.available} />}
      </div>

      <div className="card">
        <h2>Actions</h2>
        <p className="muted">Signing up from the web is coming soon.</p>
        <div className="actions-row">
          <button type="button" className="button button-primary" disabled title="Coming soon">
            Invite a partner
          </button>
          <button type="button" className="button button-secondary" disabled title="Coming soon">
            {isTeamsSeries ? "I'm looking for a team" : "I'm looking for a partner"}
          </button>
          <button type="button" className="button button-secondary" disabled title="Coming soon">
            {isTeamsSeries ? 'Available for a team' : "I'm available"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NoticeboardList({ title, rows }: { title: string; rows: SoloRow[] }) {
  return (
    <div>
      <h3>{title}</h3>
      <ul className="roster-list">
        {rows.map((row) => (
          <li key={row.memberId}>
            {row.name}
            {row.note && ` — ${row.note}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

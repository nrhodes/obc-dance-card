/**
 * My Dance Card (`/`, plan Phase 3b task, deliverable 1). Subscribes once to
 * every entry belonging to the signed-in member (`entries` where
 * `memberId == uid`, ordered by `date` — the existing `entries(memberId,
 * date)` index), then splits that one list into "upcoming" (grouped by
 * weekday → series, plan §5.4) and a collapsed "Past" (last 10) client-side.
 * A single subscription is enough at club scale and reuses the one
 * `entries(memberId, date)` composite index for both halves, rather than
 * running two separate range queries.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, documentId, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { paths, todayNZ, type Entry, type Team } from '@obc/shared';
import { db } from '../firebase';
import { useAuth } from '../auth/useAuth';
import { useEffectiveMember } from '../admin/useEffectiveMember';
import { useProgramme } from '../programme/useProgramme';
import { formatDateNZ } from '../lib/format';
import { buildPastRows, groupCardEntries, type CardRow } from '../lib/card';
import { SubscriptionError } from '../components/SubscriptionError';

const PAST_LIMIT = 10;
const MAX_TEAM_IDS = 10; // Firestore `in` query cap

function entryYear(entry: Entry): number {
  return Number(entry.date.slice(0, 4));
}

export function HomeScreen() {
  const { member } = useAuth();
  // Plan Phase 6b task deliverable 2: while an admin is acting on behalf of
  // a member, "My dance card" shows that member's card instead of the
  // admin's own.
  const { effectiveMemberId, actingAsName } = useEffectiveMember();
  const { sessions, series, weekdays, loading: programmeLoading } = useProgramme();

  const [entries, setEntries] = useState<Entry[]>([]);
  const [entriesLoaded, setEntriesLoaded] = useState(false);
  const [entriesError, setEntriesError] = useState<{ code: string } | null>(null);
  const [pastOpen, setPastOpen] = useState(false);

  useEffect(() => {
    if (!effectiveMemberId) {
      setEntries([]);
      setEntriesLoaded(true);
      return;
    }
    setEntriesLoaded(false);
    const q = query(collection(db, paths.entries()), where('memberId', '==', effectiveMemberId), orderBy('date', 'asc'));
    return onSnapshot(
      q,
      (snap) => {
        setEntries(snap.docs.map((d) => d.data() as Entry));
        setEntriesError(null);
        setEntriesLoaded(true);
      },
      (err) => {
        console.error('subscription_failed', 'home_entries', err.code);
        setEntries([]);
        setEntriesError({ code: err.code });
        setEntriesLoaded(true);
      },
    );
  }, [effectiveMemberId]);

  const today = todayNZ();
  const futureEntries = useMemo(() => entries.filter((e) => e.date >= today), [entries, today]);
  const pastEntries = useMemo(() => entries.filter((e) => e.date < today), [entries, today]);

  const teamIds = useMemo(
    () => Array.from(new Set(entries.map((e) => e.teamId).filter((id): id is string => !!id))).slice(0, MAX_TEAM_IDS),
    [entries],
  );
  const teamIdsKey = teamIds.join(',');
  const [teams, setTeams] = useState<Team[]>([]);

  useEffect(() => {
    if (teamIds.length === 0) {
      setTeams([]);
      return;
    }
    const q = query(collection(db, paths.teams()), where(documentId(), 'in', teamIds));
    return onSnapshot(
      q,
      (snap) => setTeams(snap.docs.map((d) => d.data() as Team)),
      () => setTeams([]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamIdsKey]);

  const groups = groupCardEntries(futureEntries, sessions, series, weekdays, teams);
  const pastRows = buildPastRows(pastEntries, sessions, series, teams).slice(0, PAST_LIMIT);
  const loading = programmeLoading || !entriesLoaded;
  const hasUpcoming = groups.some((g) => g.groups.length > 0);

  return (
    <div className="stack">
      <div className="card">
        <h1>Hello{member ? `, ${member.firstName}` : ''}</h1>
        {actingAsName && <p className="muted">Showing {actingAsName}&apos;s dance card.</p>}
      </div>

      <div className="card">
        <h2>My dance card</h2>
        {entriesError && <SubscriptionError resource="your dance card" />}
        {loading && <p>Loading…</p>}
        {!loading && !hasUpcoming && (
          <p className="muted">Nothing on your card yet — open the Programme to sign up.</p>
        )}
        {!loading &&
          groups.map((wd) => (
            <div key={wd.weekday} className="stack">
              <h3>{wd.label}</h3>
              {wd.groups.map((g) => (
                <div key={g.key}>
                  <p className="muted">{g.title}</p>
                  <ul className="roster-list">
                    {g.rows.map((row) => (
                      <CardRowLink key={row.entry.id} row={row} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
      </div>

      <div className="card">
        <button
          type="button"
          className="button button-link"
          aria-expanded={pastOpen}
          onClick={() => setPastOpen((o) => !o)}
        >
          {pastOpen ? 'Hide past' : 'Show past'}
        </button>
        {pastOpen && (
          <>
            {pastRows.length === 0 && <p className="muted">No past sessions yet.</p>}
            {pastRows.length > 0 && (
              <ul className="roster-list">
                {pastRows.map((row) => (
                  <li key={row.entry.id}>
                    <Link to={`/session/${entryYear(row.entry)}/${row.entry.sessionId}`}>
                      {formatDateNZ(row.date)} &mdash; {row.title} &mdash; {row.statusText}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="card">
        <p>
          <Link to="/programme">See the full programme</Link>
        </p>
      </div>
    </div>
  );
}

function CardRowLink({ row }: { row: CardRow }) {
  return (
    <li>
      <Link to={`/session/${entryYear(row.entry)}/${row.entry.sessionId}`}>
        {formatDateNZ(row.date)} &mdash; {row.statusText}
      </Link>
      {row.isTeam && <span className="badge">Team</span>}
    </li>
  );
}

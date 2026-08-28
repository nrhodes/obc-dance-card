import { Link } from 'react-router-dom';
import { todayNZ } from '@obc/shared';
import { useAuth } from '../auth/useAuth';
import { useProgramme } from '../programme/useProgramme';
import { formatDateNZ } from '../lib/format';

const NEXT_SESSIONS_COUNT = 5;

/** Home: a greeting plus a compact "Next sessions" list (plan Phase 2b task). */
export function HomeScreen() {
  const { member } = useAuth();
  const { year, sessions, loading } = useProgramme();

  const today = todayNZ();
  const nextSessions = [...sessions]
    .filter((s) => s.kind !== 'noBridge' && s.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, NEXT_SESSIONS_COUNT);

  return (
    <div className="stack">
      <div className="card">
        <h1>Hello{member ? `, ${member.firstName}` : ''}</h1>
        <p>Coming soon: your dance card.</p>
      </div>

      <div className="card">
        <h2>Next sessions</h2>
        {loading && <p>Loading…</p>}
        {!loading && year == null && <p className="muted">The programme hasn&apos;t been published yet.</p>}
        {!loading && year != null && nextSessions.length === 0 && <p className="muted">No upcoming sessions.</p>}
        {!loading && nextSessions.length > 0 && (
          <ul className="session-date-list">
            {nextSessions.map((session) => (
              <li key={session.id}>
                <Link to={`/session/${year}/${session.id}`}>
                  {formatDateNZ(session.date)} &mdash; {session.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p>
          <Link to="/programme">See the full programme</Link>
        </p>
      </div>
    </div>
  );
}

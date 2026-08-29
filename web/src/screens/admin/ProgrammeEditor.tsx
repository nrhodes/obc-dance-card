/**
 * Admin: edit an imported programme's series and sessions (plan §9.2
 * `updateSeries`/`updateSession`, Phase 6b task deliverable 3). Admins can
 * read a draft or published programme's subcollections (rules §10), so this
 * subscribes directly rather than going through `ProgrammeProvider` (which
 * only ever tracks the one *published* year members can see).
 *
 * Sessions show a live count of non-cancelled entries so an admin can see up
 * front whether a date move will be refused (`updateSession` cascade rules,
 * plan §9.3) — computed from a single per-year `entries` subscription rather
 * than one listener per session.
 */
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { paths, type Entry, type Programme, type Series, type Session } from '@obc/shared';
import { db } from '../../firebase';
import { formatDateNZ } from '../../lib/format';
import { SubscriptionError } from '../../components/SubscriptionError';
import { SeriesEditDialog } from './SeriesEditDialog';
import { SessionEditDialog } from './SessionEditDialog';

type EditorDialog = { kind: 'series'; series: Series } | { kind: 'session'; session: Session };

export function ProgrammeEditor() {
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [series, setSeries] = useState<Series[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<{ code: string } | null>(null);
  const [dialog, setDialog] = useState<EditorDialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedSeriesId, setExpandedSeriesId] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, paths.programmes()), orderBy('year', 'desc')),
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as Programme);
        setProgrammes(rows);
        setYear((current) => current ?? rows[0]?.year ?? null);
      },
      (err) => {
        console.error('subscription_failed', 'admin_programme_editor_years', err.code);
        setError({ code: err.code });
      },
    );
  }, []);

  useEffect(() => {
    if (year == null) {
      setSeries([]);
      setSessions([]);
      setEntries([]);
      return;
    }
    const unsubSeries = onSnapshot(
      collection(db, paths.series(year)),
      (snap) => setSeries(snap.docs.map((d) => d.data() as Series)),
      (err) => {
        console.error('subscription_failed', 'admin_programme_editor_series', err.code);
        setError({ code: err.code });
      },
    );
    const unsubSessions = onSnapshot(
      collection(db, paths.sessions(year)),
      (snap) => setSessions(snap.docs.map((d) => d.data() as Session)),
      (err) => {
        console.error('subscription_failed', 'admin_programme_editor_sessions', err.code);
        setError({ code: err.code });
      },
    );
    const unsubEntries = onSnapshot(
      query(collection(db, paths.entries()), where('date', '>=', `${year}-01-01`), where('date', '<=', `${year}-12-31`)),
      (snap) => setEntries(snap.docs.map((d) => d.data() as Entry)),
      (err) => {
        console.error('subscription_failed', 'admin_programme_editor_entries', err.code);
        setError({ code: err.code });
      },
    );
    return () => {
      unsubSeries();
      unsubSessions();
      unsubEntries();
    };
  }, [year]);

  const activeCountBySessionId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) {
      if (e.status === 'cancelled') continue;
      counts.set(e.sessionId, (counts.get(e.sessionId) ?? 0) + 1);
    }
    return counts;
  }, [entries]);

  const sortedSeries = useMemo(() => [...series].sort((a, b) => a.weekday.localeCompare(b.weekday) || a.order - b.order), [series]);

  if (programmes.length === 0 && !error) return null;

  return (
    <div className="card">
      <h2>Edit series &amp; sessions</h2>
      {error && <SubscriptionError resource="the programme editor" />}
      {notice && (
        <div className="alert alert-success" role="status">
          {notice}
        </div>
      )}
      <div className="field">
        <label htmlFor="programme-editor-year">Year</label>
        <select
          id="programme-editor-year"
          value={year ?? ''}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {programmes.map((p) => (
            <option key={p.id} value={p.year}>
              {p.year} ({p.status})
            </option>
          ))}
        </select>
      </div>

      {sortedSeries.map((s) => {
        const seriesSessions = sessions.filter((sess) => sess.seriesId === s.id).sort((a, b) => a.date.localeCompare(b.date));
        const expanded = expandedSeriesId === s.id;
        return (
          <div key={s.id} className="card">
            <div className="actions-row">
              <button
                type="button"
                className="button button-link"
                onClick={() => setExpandedSeriesId(expanded ? null : s.id)}
                aria-expanded={expanded}
              >
                {s.weekday} &middot; {s.name} ({s.format}, {s.scoring})
              </button>
              <button type="button" className="button button-secondary" onClick={() => setDialog({ kind: 'series', series: s })}>
                Edit series
              </button>
            </div>
            {expanded && (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Title</th>
                    <th>Kind</th>
                    <th>Partner required</th>
                    <th>Sign-ups</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {seriesSessions.map((sess) => (
                    <tr key={sess.id}>
                      <td>{formatDateNZ(sess.date)}</td>
                      <td>{sess.title}</td>
                      <td>{sess.kind}</td>
                      <td>{sess.partnerRequired ? 'Yes' : 'No'}</td>
                      <td>{activeCountBySessionId.get(sess.id) ?? 0}</td>
                      <td>
                        <button type="button" className="button button-link" onClick={() => setDialog({ kind: 'session', session: sess })}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      {dialog?.kind === 'series' && year != null && (
        <SeriesEditDialog
          year={year}
          series={dialog.series}
          onClose={() => setDialog(null)}
          onSaved={(message) => {
            setDialog(null);
            setNotice(message);
          }}
        />
      )}

      {dialog?.kind === 'session' && year != null && (
        <SessionEditDialog
          year={year}
          session={dialog.session}
          activeEntryCount={activeCountBySessionId.get(dialog.session.id) ?? 0}
          onClose={() => setDialog(null)}
          onSaved={(message) => {
            setDialog(null);
            setNotice(message);
          }}
          onRemoved={(message) => {
            setDialog(null);
            setNotice(message);
          }}
        />
      )}
    </div>
  );
}

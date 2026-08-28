/**
 * Admin-only list of every `programmes/{year}` doc (any status) — admins can
 * read drafts (plan §10), members cannot. Lets an admin publish a draft
 * without re-running the import screen's dry-run gate.
 */
import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { paths, type Programme } from '@obc/shared';
import { db, toAppError } from '../../firebase';
import { publishProgramme } from '../../api';
import { mapGenericError } from '../../auth/errors';

export function AdminProgrammeList() {
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishingYear, setPublishingYear] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, paths.programmes()), orderBy('year', 'desc'));
    return onSnapshot(
      q,
      (snap) => {
        setProgrammes(snap.docs.map((d) => d.data() as Programme));
        setLoading(false);
      },
      () => {
        setProgrammes([]);
        setLoading(false);
      },
    );
  }, []);

  async function handlePublish(year: number) {
    if (!window.confirm(`Publish the ${year} programme? Members will be notified.`)) return;
    setPublishingYear(year);
    setError(null);
    try {
      await publishProgramme({ year });
    } catch (err) {
      setError(mapGenericError(toAppError(err)));
    } finally {
      setPublishingYear(null);
    }
  }

  return (
    <div className="card">
      <h2>All programmes</h2>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {loading && <p>Loading…</p>}
      {!loading && programmes.length === 0 && <p className="muted">No programme has been imported yet.</p>}
      {!loading && programmes.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Year</th>
                <th>Status</th>
                <th>Imported</th>
                <th>Published</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {programmes.map((p) => (
                <tr key={p.id}>
                  <td>{p.year}</td>
                  <td>{p.status}</td>
                  <td>{p.importedAt ?? '—'}</td>
                  <td>{p.publishedAt ?? '—'}</td>
                  <td>
                    {p.status === 'draft' && (
                      <button
                        type="button"
                        className="button button-primary"
                        disabled={publishingYear === p.year}
                        onClick={() => void handlePublish(p.year)}
                      >
                        {publishingYear === p.year ? 'Publishing…' : `Publish ${p.year}`}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

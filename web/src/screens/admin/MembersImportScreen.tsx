/**
 * Admin: members import (plan §9.2 `importMembers`, §13). A dry run of the
 * *exact same text* must be reviewed before Import is enabled — editing the
 * text after a dry run re-locks Import until it is dry-run again.
 */
import { useState } from 'react';
import type { MemberImportReport } from '@obc/shared';
import { importMembers } from '../../api';
import { toAppError } from '../../firebase';
import { mapGenericError } from '../../auth/errors';
import { isMassDeactivationWarning } from './massDeactivationWarning';

export function MembersImportScreen() {
  const [csvText, setCsvText] = useState('');
  const [reviewedText, setReviewedText] = useState<string | null>(null);
  const [report, setReport] = useState<MemberImportReport | null>(null);
  const [reportKind, setReportKind] = useState<'dryRun' | 'import' | null>(null);
  const [allowMassDeactivation, setAllowMassDeactivation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canImport = csvText.trim().length > 0 && reviewedText === csvText && !busy;
  const massDeactivationWarning = report?.warnings.find(isMassDeactivationWarning) ?? null;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result ?? ''));
      setReviewedText(null);
      setReport(null);
    };
    reader.readAsText(file);
  }

  function handleTextChange(value: string) {
    setCsvText(value);
    setReviewedText(null);
    setReport(null);
  }

  async function handleDryRun() {
    setBusy(true);
    setError(null);
    try {
      const result = await importMembers({ csv: csvText, dryRun: true, allowMassDeactivation });
      setReport(result);
      setReportKind('dryRun');
      setReviewedText(csvText);
    } catch (err) {
      setError(mapGenericError(toAppError(err)));
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    setBusy(true);
    setError(null);
    try {
      const result = await importMembers({ csv: csvText, allowMassDeactivation });
      setReport(result);
      setReportKind('import');
      // Force a fresh dry run before any further import of edited/new text.
      setReviewedText(null);
    } catch (err) {
      setError(mapGenericError(toAppError(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <h1>Import members</h1>
        <p>
          <a href="/templates/members.csv" download>
            Download the members.csv template
          </a>
        </p>

        <div className="field">
          <label htmlFor="members-csv-file">Choose a CSV file</label>
          <input id="members-csv-file" type="file" accept=".csv,text/csv" onChange={handleFileChange} />
        </div>

        <div className="field">
          <label htmlFor="members-csv-paste">Or paste the CSV contents</label>
          <textarea
            id="members-csv-paste"
            rows={10}
            value={csvText}
            onChange={(e) => handleTextChange(e.target.value)}
          />
        </div>

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        <div className="actions-row">
          <button
            type="button"
            className="button button-secondary"
            disabled={csvText.trim().length === 0 || busy}
            onClick={() => void handleDryRun()}
          >
            {busy ? 'Checking…' : 'Check file (dry run)'}
          </button>
          <button type="button" className="button button-primary" disabled={!canImport} onClick={() => void handleImport()}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
        {reviewedText !== csvText && (
          <p className="muted">Run a dry run of this exact file before importing.</p>
        )}
      </div>

      {report && (
        <div className="card">
          <h2>{reportKind === 'dryRun' ? 'Dry run result' : 'Import result'}</h2>
          <ul>
            <li>Added: {report.added}</li>
            <li>Updated: {report.updated}</li>
            <li>Deactivated: {report.deactivated}</li>
            <li>Unchanged: {report.unchanged}</li>
          </ul>

          {report.warnings.length > 0 && (
            <div className="alert alert-error" role="alert">
              <strong>Warnings</strong>
              <ul>
                {report.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              {massDeactivationWarning && (
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={allowMassDeactivation}
                    onChange={(e) => setAllowMassDeactivation(e.target.checked)}
                  />
                  Yes, deactivate these members
                </label>
              )}
            </div>
          )}

          {report.errors.length > 0 && (
            <>
              <h3>Errors</h3>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.errors.map((e, i) => (
                      <tr key={i}>
                        <td>{e.row}</td>
                        <td>{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

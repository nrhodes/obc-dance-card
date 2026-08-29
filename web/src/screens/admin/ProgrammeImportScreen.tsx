/**
 * Admin: programme import (plan §9.2 `importProgramme`/`publishProgramme`,
 * §13). Mirrors `MembersImportScreen`'s dry-run-before-import gate, but over
 * three CSVs + a year: any edit to any of the four re-locks Import until a
 * fresh dry run of the exact same inputs has been reviewed.
 */
import { useState } from 'react';
import type { ProgrammeImportReport } from '@obc/shared';
import { importProgramme } from '../../api';
import { toAppError } from '../../firebase';
import { mapGenericError } from '../../auth/errors';
import { groupErrorsByFile, isAlreadyPublishedError, isWouldRemoveSessionsError } from './programmeImportErrors';
import { defaultProgrammeImportYear } from './programmeYearDefault';
import { AdminProgrammeList } from './AdminProgrammeList';
import { ProgrammeEditor } from './ProgrammeEditor';

interface ReviewedInputs {
  year: number;
  weekdaysCsv: string;
  seriesCsv: string;
  singlesCsv: string;
  replace: boolean;
}

const FILE_LABELS: Record<string, string> = {
  weekdays: 'weekdays.csv',
  series: 'series.csv',
  singles: 'singles.csv',
};

export function ProgrammeImportScreen() {
  const [year, setYear] = useState<number>(defaultProgrammeImportYear());
  const [weekdaysCsv, setWeekdaysCsv] = useState('');
  const [seriesCsv, setSeriesCsv] = useState('');
  const [singlesCsv, setSinglesCsv] = useState('');
  const [replace, setReplace] = useState(false);
  const [reviewed, setReviewed] = useState<ReviewedInputs | null>(null);

  const [report, setReport] = useState<ProgrammeImportReport | null>(null);
  const [reportKind, setReportKind] = useState<'dryRun' | 'import' | null>(null);
  const [alreadyPublished, setAlreadyPublished] = useState(false);
  const [removeSessionsMessage, setRemoveSessionsMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const current: ReviewedInputs = { year, weekdaysCsv, seriesCsv, singlesCsv, replace };
  const hasAnyText = weekdaysCsv.trim().length > 0 || seriesCsv.trim().length > 0 || singlesCsv.trim().length > 0;
  const isReviewed = reviewed != null && sameInputs(reviewed, current);
  const canImport = hasAnyText && isReviewed && !busy;

  function invalidateReview() {
    setReviewed(null);
    setReport(null);
    setAlreadyPublished(false);
    setRemoveSessionsMessage(null);
  }

  function handleFileChange(setter: (v: string) => void) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        setter(String(reader.result ?? ''));
        invalidateReview();
      };
      reader.readAsText(file);
    };
  }

  function handleTextChange(setter: (v: string) => void) {
    return (value: string) => {
      setter(value);
      invalidateReview();
    };
  }

  function handleYearChange(value: number) {
    setYear(value);
    invalidateReview();
  }

  function handleReplaceChange(value: boolean) {
    setReplace(value);
    invalidateReview();
  }

  function handleError(err: unknown) {
    const appErr = toAppError(err);
    if (appErr.code === 'failed-precondition' && isAlreadyPublishedError(appErr.message)) {
      setAlreadyPublished(true);
      setError('This programme year is already published. Check "Replace existing programme" below and try again.');
      return;
    }
    if (appErr.code === 'failed-precondition' && isWouldRemoveSessionsError(appErr.message)) {
      setRemoveSessionsMessage(appErr.message);
      return;
    }
    setError(mapGenericError(appErr));
  }

  async function handleDryRun() {
    setBusy(true);
    setError(null);
    setAlreadyPublished(false);
    setRemoveSessionsMessage(null);
    try {
      const result = await importProgramme({ year, weekdaysCsv, seriesCsv, singlesCsv, dryRun: true, replace });
      setReport(result);
      setReportKind('dryRun');
      setReviewed(current);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    setBusy(true);
    setError(null);
    setAlreadyPublished(false);
    setRemoveSessionsMessage(null);
    try {
      const result = await importProgramme({ year, weekdaysCsv, seriesCsv, singlesCsv, replace });
      setReport(result);
      setReportKind('import');
      setReviewed(null);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  }

  const groupedErrors = report ? groupErrorsByFile(report.errors) : [];

  return (
    <div className="stack">
      <div className="card">
        <h1>Import programme</h1>
        <p>
          <a href="/templates/weekdays.csv" download>
            Download the weekdays.csv template
          </a>
          {' · '}
          <a href="/templates/series.csv" download>
            Download the series.csv template
          </a>
          {' · '}
          <a href="/templates/singles.csv" download>
            Download the singles.csv template
          </a>
        </p>

        <div className="field">
          <label htmlFor="programme-year">Year</label>
          <input
            id="programme-year"
            type="number"
            value={year}
            onChange={(e) => handleYearChange(Number(e.target.value))}
          />
        </div>

        <div className="field">
          <label htmlFor="weekdays-csv-file">weekdays.csv</label>
          <input id="weekdays-csv-file" type="file" accept=".csv,text/csv" onChange={handleFileChange(setWeekdaysCsv)} />
          <textarea
            aria-label="weekdays.csv contents"
            rows={4}
            value={weekdaysCsv}
            onChange={(e) => handleTextChange(setWeekdaysCsv)(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="series-csv-file">series.csv</label>
          <input id="series-csv-file" type="file" accept=".csv,text/csv" onChange={handleFileChange(setSeriesCsv)} />
          <textarea
            aria-label="series.csv contents"
            rows={4}
            value={seriesCsv}
            onChange={(e) => handleTextChange(setSeriesCsv)(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="singles-csv-file">singles.csv</label>
          <input id="singles-csv-file" type="file" accept=".csv,text/csv" onChange={handleFileChange(setSinglesCsv)} />
          <textarea
            aria-label="singles.csv contents"
            rows={4}
            value={singlesCsv}
            onChange={(e) => handleTextChange(setSinglesCsv)(e.target.value)}
          />
        </div>

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        {alreadyPublished && (
          <div className="alert alert-error">
            <label className="checkbox-field">
              <input type="checkbox" checked={replace} onChange={(e) => handleReplaceChange(e.target.checked)} />
              Replace existing programme
            </label>
            <p className="muted">
              Replacing overwrites {year}&apos;s weekdays, series and sessions with this import. The import still
              refuses to remove any session that has non-cancelled sign-ups.
            </p>
          </div>
        )}

        {removeSessionsMessage && (
          <div className="alert alert-error" role="alert">
            {removeSessionsMessage}
          </div>
        )}

        <div className="actions-row">
          <button
            type="button"
            className="button button-secondary"
            disabled={!hasAnyText || busy}
            onClick={() => void handleDryRun()}
          >
            {busy ? 'Checking…' : 'Check files (dry run)'}
          </button>
          <button type="button" className="button button-primary" disabled={!canImport} onClick={() => void handleImport()}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
        {hasAnyText && !isReviewed && (
          <p className="muted">Run a dry run of these exact files before importing.</p>
        )}
      </div>

      {report && (
        <div className="card">
          <h2>{reportKind === 'dryRun' ? 'Dry run result' : 'Import result'}</h2>
          <ul>
            <li>Weekdays: {report.weekdays}</li>
            <li>Series: {report.series}</li>
            <li>Sessions: {report.sessions}</li>
            <li>Would remove sessions: {report.wouldRemoveSessions}</li>
          </ul>

          {report.warnings.length > 0 && (
            <div className="alert alert-error" role="alert">
              <strong>Warnings</strong>
              <ul>
                {report.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {groupedErrors.map(({ file, errors }) => (
            <div key={file}>
              <h3>Errors — {FILE_LABELS[file] ?? file}</h3>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errors.map((e, i) => (
                      <tr key={i}>
                        <td>{e.row}</td>
                        <td>{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {reportKind === 'import' && report.errors.length === 0 && (
            <p>
              Draft {year} imported. Publish it from the list below when it&apos;s ready — members will be notified.
            </p>
          )}
        </div>
      )}

      <AdminProgrammeList />
      <ProgrammeEditor />
    </div>
  );
}

function sameInputs(a: ReviewedInputs, b: ReviewedInputs): boolean {
  return (
    a.year === b.year &&
    a.weekdaysCsv === b.weekdaysCsv &&
    a.seriesCsv === b.seriesCsv &&
    a.singlesCsv === b.singlesCsv &&
    a.replace === b.replace
  );
}

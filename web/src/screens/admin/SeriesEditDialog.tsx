/**
 * Admin: edit a series (`updateSeries`, plan §9.2, Phase 6b task deliverable
 * 3). Only the fields `UpdateSeriesPatchSchema` accepts are editable here;
 * a format change is refused server-side while the series has non-cancelled
 * entries — that `failed-precondition` message is written to be shown
 * verbatim (see `mapAdminActionError`).
 */
import { useState } from 'react';
import type { Series, SeriesFormat, ScoringType } from '@obc/shared';
import { SCORING_TYPES, SERIES_FORMATS } from '@obc/shared';
import type { AppError } from '../../firebase';
import { updateSeries } from '../../api';
import { mapAdminActionError } from '../../admin/adminErrors';
import { Dialog } from '../../components/Dialog';

export function SeriesEditDialog({
  year,
  series,
  onClose,
  onSaved,
}: {
  year: number;
  series: Series;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(series.name);
  const [scoring, setScoring] = useState<ScoringType>(series.scoring);
  const [format, setFormat] = useState<SeriesFormat>(series.format);
  const [allowSubstitute, setAllowSubstitute] = useState(series.allowSubstitute);
  const [eligibilityNote, setEligibilityNote] = useState(series.eligibilityNote ?? '');
  const [generalNote, setGeneralNote] = useState(series.generalNote ?? '');
  const [bestOfN, setBestOfN] = useState(series.bestOf?.n?.toString() ?? '');
  const [bestOfM, setBestOfM] = useState(series.bestOf?.m?.toString() ?? '');
  const [teamMin, setTeamMin] = useState(series.teamMin.toString());
  const [teamMax, setTeamMax] = useState(series.teamMax.toString());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const bothBlank = bestOfN.trim() === '' && bestOfM.trim() === '';
      const bothSet = bestOfN.trim() !== '' && bestOfM.trim() !== '';
      // Leave `bestOf` as-is (omit from the patch) if only one of the two
      // fields was cleared — an incomplete edit, not a deliberate "none".
      const bestOf = bothBlank ? null : bothSet ? { n: Number(bestOfN), m: Number(bestOfM) } : undefined;
      await updateSeries({
        year,
        seriesId: series.id,
        patch: {
          name,
          scoring,
          format,
          allowSubstitute,
          teamMin: Number(teamMin),
          teamMax: Number(teamMax),
          ...(bestOf !== undefined ? { bestOf } : {}),
          ...(eligibilityNote.trim() ? { eligibilityNote: eligibilityNote.trim() } : {}),
          ...(generalNote.trim() ? { generalNote: generalNote.trim() } : {}),
        },
      });
      onSaved(`${name} updated.`);
    } catch (err) {
      setError(mapAdminActionError(err as AppError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Edit ${series.name}`} onClose={onClose}>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <div className="field">
        <label htmlFor="series-name">Name</label>
        <input id="series-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="series-scoring">Scoring</label>
        <select id="series-scoring" value={scoring} onChange={(e) => setScoring(e.target.value as ScoringType)}>
          {SCORING_TYPES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="series-format">Format</label>
        <select id="series-format" value={format} onChange={(e) => setFormat(e.target.value as SeriesFormat)}>
          {SERIES_FORMATS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="series-bestof-n">Best of (n from m sessions) — leave both blank for none</label>
        <div className="actions-row">
          <input
            id="series-bestof-n"
            type="number"
            min={1}
            aria-label="Best of: n"
            value={bestOfN}
            onChange={(e) => setBestOfN(e.target.value)}
          />
          <input type="number" min={1} aria-label="Best of: m" value={bestOfM} onChange={(e) => setBestOfM(e.target.value)} />
        </div>
      </div>
      <label className="checkbox-field">
        <input type="checkbox" checked={allowSubstitute} onChange={(e) => setAllowSubstitute(e.target.checked)} />
        Allow a one-week substitute
      </label>
      <div className="field">
        <label htmlFor="series-eligibility">Eligibility note</label>
        <input id="series-eligibility" type="text" value={eligibilityNote} onChange={(e) => setEligibilityNote(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="series-general-note">General note</label>
        <input id="series-general-note" type="text" value={generalNote} onChange={(e) => setGeneralNote(e.target.value)} />
      </div>
      {format === 'Teams' && (
        <div className="actions-row">
          <div className="field">
            <label htmlFor="series-team-min">Team min</label>
            <input id="series-team-min" type="number" min={1} value={teamMin} onChange={(e) => setTeamMin(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="series-team-max">Team max</label>
            <input id="series-team-max" type="number" min={1} value={teamMax} onChange={(e) => setTeamMax(e.target.value)} />
          </div>
        </div>
      )}
      <div className="actions-row">
        <button type="button" className="button button-primary" disabled={busy} onClick={() => void handleSave()}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

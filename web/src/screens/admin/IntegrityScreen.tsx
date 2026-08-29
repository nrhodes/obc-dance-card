/**
 * Admin: Integrity (`runPairingSweep`, plan §7, §9.2, Phase 6b task
 * deliverable 6). "Run check" mirrors the nightly `verifyPairingConsistency`
 * job with `repair: false`; "Run check and repair" additionally repairs the
 * conservative, deterministic violation shapes `runPairingSweep` documents
 * (ops-runbook: revert a one-sided/mismatched pairing to "looking for a
 * partner", clear orphan substitution fields, reconcile a team roster's
 * entries) and writes a `pairing_repair` audit row per repair — a link to
 * the audit log, pre-filtered to that action, is offered after a repair run.
 */
import { useState } from 'react';
import type { RunPairingSweepResult } from '@obc/shared';
import { Link } from 'react-router-dom';
import type { AppError } from '../../firebase';
import { runPairingSweep } from '../../api';
import { mapAdminActionError } from '../../admin/adminErrors';
import { ConfirmDialog } from '../../components/ConfirmDialog';

export function IntegrityScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunPairingSweepResult | null>(null);
  const [lastRepaired, setLastRepaired] = useState(false);
  const [confirmingRepair, setConfirmingRepair] = useState(false);

  async function run(repair: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await runPairingSweep({ repair });
      setResult(res);
      setLastRepaired(repair);
      setConfirmingRepair(false);
    } catch (err) {
      setError(mapAdminActionError(err as AppError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <h1>Integrity</h1>
        <p className="muted">
          Checks every pairing and team roster with a future session against the invariants (plan §7) — the same check
          that runs automatically every night.
        </p>

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        <div className="actions-row">
          <button type="button" className="button button-secondary" disabled={busy} onClick={() => void run(false)}>
            {busy ? 'Checking…' : 'Run check'}
          </button>
          <button type="button" className="button button-danger" disabled={busy} onClick={() => setConfirmingRepair(true)}>
            Run check and repair
          </button>
        </div>
      </div>

      {result && (
        <div className="card">
          <h2>{lastRepaired ? 'Check and repair result' : 'Check result'}</h2>
          <ul>
            <li>Sessions checked: {result.checkedSessions}</li>
            <li>Teams checked: {result.checkedTeams}</li>
            <li>Violations found: {result.violations.length}</li>
            {lastRepaired && <li>Repaired: {result.repaired}</li>}
          </ul>

          {result.violations.length === 0 && <p>No violations found.</p>}

          {result.violations.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Kind</th>
                    <th>Id</th>
                    <th>Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {result.violations.map((v, i) => (
                    <tr key={i}>
                      <td>{v.kind}</td>
                      <td>{v.id}</td>
                      <td>{v.issues.join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {lastRepaired && result.repaired > 0 && (
            <p>
              <Link to="/admin/audit?action=pairing_repair">See the repair entries in the audit log</Link>
            </p>
          )}
        </div>
      )}

      {confirmingRepair && (
        <ConfirmDialog
          title="Run check and repair?"
          body="This reverts one-sided or mismatched pairings to “looking for a partner”, clears orphaned substitute fields, and reconciles team rosters with their entries. Every repair is written to the audit log. This cannot be undone."
          confirmLabel="Run check and repair"
          danger
          busy={busy}
          error={error}
          onConfirm={() => void run(true)}
          onClose={() => setConfirmingRepair(false)}
        />
      )}
    </div>
  );
}

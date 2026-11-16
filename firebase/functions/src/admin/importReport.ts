/**
 * What an import stores about itself (security review 2026-11-16, L9).
 *
 * Import handlers return their full report to the admin who ran them — row
 * numbers, messages and, for a failed row, the raw CSV cells, so the admin
 * can fix the file. The copy persisted at `imports/{id}` is a different
 * matter: it outlives the admin's screen, is never shown anywhere (the rules
 * deny client reads; no UI lists it), and a raw members row is a name, an
 * email and a phone number. Persisting that indefinitely contradicted the
 * erasure promise. So the stored copy drops `raw`, and `purgeExpired`
 * removes import documents after two years like audit rows.
 */

/** The persisted form of an import report: every error keeps its row and message but loses the raw CSV cells. */
export function redactImportReport<E extends object, R extends { errors: E[] }>(report: R): R {
  const errors = report.errors.map((error) => {
    const copy = { ...(error as Record<string, unknown>) };
    delete copy.raw;
    return copy as unknown as E;
  });
  return { ...report, errors };
}

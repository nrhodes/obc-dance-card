/**
 * Recognises the two `failed-precondition` shapes `importProgramme` can throw
 * (plan §9.2 / §13) so the UI can react differently to each: "already
 * published" offers a `replace: true` checkbox, while "would remove sessions
 * with active entries" is display-safe and rendered verbatim (it names no
 * PII, just dates and internal session ids).
 */
export function isAlreadyPublishedError(message: string): boolean {
  return /already published/i.test(message);
}

export function isWouldRemoveSessionsError(message: string): boolean {
  return /would remove/i.test(message);
}

const FILE_ORDER = ['weekdays', 'series', 'singles'] as const;

/** Groups CSV row errors by their `file`, in a fixed weekdays/series/singles order. */
export function groupErrorsByFile<T extends { file: string }>(errors: T[]): Array<{ file: string; errors: T[] }> {
  const byFile = new Map<string, T[]>();
  for (const e of errors) {
    const list = byFile.get(e.file) ?? [];
    list.push(e);
    byFile.set(e.file, list);
  }
  const order = [...FILE_ORDER, ...[...byFile.keys()].filter((f) => !(FILE_ORDER as readonly string[]).includes(f))];
  return order.filter((f) => byFile.has(f)).map((file) => ({ file, errors: byFile.get(file)! }));
}

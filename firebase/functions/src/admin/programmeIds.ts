/**
 * Deterministic id generation for programme import (plan §5.4). Pure — no
 * Firebase types, no I/O — so it can be unit tested directly with plain
 * vitest and reused by both `importProgramme` and the seed script.
 */
import type { Weekday } from '@obc/shared';

/** lowercase, non-alphanumerics -> '-', collapsed, trimmed. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Assigns a deterministic `seriesId` to every row of `series.csv`, in file
 * order: `${weekday}-${slug(name)}`, with `-2`, `-3`, ... appended when two
 * series in the same weekday slug identically.
 */
export function assignSeriesIds(rows: Array<{ weekday: Weekday; name: string }>): string[] {
  const counts = new Map<string, number>();
  const ids: string[] = [];
  for (const row of rows) {
    const base = `${row.weekday}-${slugify(row.name)}`;
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    ids.push(n === 1 ? base : `${base}-${n}`);
  }
  return ids;
}

/** `${seriesId}-${date}` for a series-generated session. */
export function sessionIdForSeries(seriesId: string, date: string): string {
  return `${seriesId}-${date}`;
}

/** `${year}-${date}-${weekday}` for a singles (Holiday Bridge / No Bridge) session. */
export function sessionIdForSingle(year: number, date: string, weekday: Weekday): string {
  return `${year}-${date}-${weekday}`;
}

/**
 * Pure helpers shared by the import functions, the callables, and the clients.
 * No I/O, no Firebase types.
 */

import {
  MEMBER_GRADES,
  SCORING_TYPES,
  SERIES_FORMATS,
  SESSION_KINDS,
  WEEKDAYS,
  isOneOf,
  type MemberGrade,
  type ScoringType,
  type SeriesFormat,
  type SessionKind,
  type Weekday,
} from './enums.js';
import type { Entry } from './models.js';
import type { IsoDate, TimeOfDay } from './primitives.js';

// NB: the pairing/team invariant checks (I1–I6, I9) live in `pairing.ts`, not
// here — this module stays limited to pure, non-domain CSV/date/string helpers.

const TRUE_TOKENS = new Set(['true', 'yes', 'y', '1']);
const FALSE_TOKENS = new Set(['false', 'no', 'n', '0', '']);

/** Coerce a CSV cell to a boolean, or throw when it is neither. */
export function parseBooleanCell(value: string, field: string): boolean {
  const token = value.trim().toLowerCase();
  if (TRUE_TOKENS.has(token)) return true;
  if (FALSE_TOKENS.has(token)) return false;
  throw new Error(`${field}: expected a yes/no value, got "${value}"`);
}

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export function parseGrade(value: string): MemberGrade {
  const trimmed = value.trim();
  const match = MEMBER_GRADES.find((g) => g.toLowerCase() === trimmed.toLowerCase());
  return match ?? 'Unknown';
}

export function parseWeekday(value: string, field = 'weekday'): Weekday {
  const token = value.trim().toLowerCase();
  if (isOneOf(WEEKDAYS, token)) return token;
  throw new Error(`${field}: expected one of ${WEEKDAYS.join(', ')}, got "${value}"`);
}

export function parseScoring(value: string, field = 'scoring'): ScoringType {
  const token = value.trim();
  const match = SCORING_TYPES.find((s) => s.toLowerCase() === token.toLowerCase());
  if (match) return match;
  throw new Error(`${field}: expected Scr or Hcp, got "${value}"`);
}

export function parseFormat(value: string, field = 'format'): SeriesFormat {
  const token = value.trim();
  const match = SERIES_FORMATS.find((f) => f.toLowerCase() === token.toLowerCase());
  if (match) return match;
  throw new Error(`${field}: expected Pairs, Teams or Individual, got "${value}"`);
}

export function parseSessionKind(value: string, field = 'kind'): SessionKind {
  const token = value.trim();
  const match = SESSION_KINDS.find((k) => k.toLowerCase() === token.toLowerCase());
  if (match) return match;
  throw new Error(`${field}: expected one of ${SESSION_KINDS.join(', ')}, got "${value}"`);
}

const TIME_OF_DAY_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** `HH:MM`, 24h clock. */
export function isTimeOfDay(value: string): value is TimeOfDay {
  return TIME_OF_DAY_RE.test(value.trim());
}

export function assertTimeOfDay(value: string, field = 'time'): TimeOfDay {
  const trimmed = value.trim();
  if (!isTimeOfDay(trimmed)) throw new Error(`${field}: expected HH:MM (24h), got "${value}"`);
  return trimmed;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE_RE.test(value.trim())) return false;
  const d = new Date(`${value.trim()}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value.trim();
}

export function assertIsoDate(value: string, field = 'date'): IsoDate {
  if (!isIsoDate(value)) throw new Error(`${field}: expected YYYY-MM-DD, got "${value}"`);
  return value.trim();
}

/** Parse a `;`-separated date list, de-duplicated and sorted ascending. */
export function parseDateList(value: string, field = 'dates'): IsoDate[] {
  const parts = value
    .split(/[;,]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error(`${field}: at least one date is required`);
  const seen = new Set<string>();
  for (const p of parts) {
    if (!isIsoDate(p)) throw new Error(`${field}: "${p}" is not a valid YYYY-MM-DD date`);
    seen.add(p);
  }
  return [...seen].sort();
}

export function parseOptionalInt(value: string, field: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${field}: expected a non-negative integer, got "${value}"`);
  }
  return n;
}

/** True when a status keeps the member "occupied" for a session. */
export function isActiveStatus(status: Entry['status']): boolean {
  return status !== 'cancelled';
}

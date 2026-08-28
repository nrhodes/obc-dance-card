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
import type { IsoDate } from './primitives.js';

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

/**
 * The bidirectional-pairing invariant, expressed as a pure check so the same
 * logic backs the runtime transaction guard, the `verifyPairingConsistency`
 * sweep, and the tests.
 *
 * Returns `null` when the two entries are a valid mirror image, or a
 * human-readable reason when they are not.
 */
export function pairingMismatchReason(a: Entry, b: Entry): string | null {
  if (a.status !== 'confirmed' || b.status !== 'confirmed') {
    return 'both entries must be confirmed';
  }
  if (a.sessionId !== b.sessionId) return 'entries are for different sessions';
  if (!a.pairingId || a.pairingId !== b.pairingId) return 'pairingId does not match';
  if (a.memberId !== b.partnerMemberId || b.memberId !== a.partnerMemberId) {
    return 'memberId / partnerMemberId are not mirrored';
  }
  if (a.memberId === b.memberId) return 'both entries belong to the same member';
  const aSub = a.substituteMemberId ?? null;
  const bSub = b.substituteMemberId ?? null;
  if (aSub !== bSub) return 'substitute is recorded on only one side';
  return null;
}

/** True when a status keeps the member "occupied" for a session. */
export function isActiveStatus(status: Entry['status']): boolean {
  return status !== 'cancelled';
}

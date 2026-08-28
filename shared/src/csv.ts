/**
 * Row shapes for the four admin CSV imports. Column headers in the actual files
 * match these keys exactly (see `shared/templates/*.csv` and `docs/csv-formats.md`).
 *
 * Every field arrives as a string from the CSV parser; the import function is
 * responsible for trimming, coercing, and validating. Booleans accept
 * `true/false/yes/no/1/0` case-insensitively; date lists are `;`-separated.
 */

import type { IsoDate } from './primitives.js';

/** members.csv */
export interface MemberCsvRow {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** One of the MemberGrade values; blank/unrecognised becomes "Unknown". */
  grade: string;
}

/** weekdays.csv */
export interface WeekdayCsvRow {
  /** monday | tuesday | wednesday | thursday | friday */
  weekday: string;
  label: string;
  startTime: string;
  seatedBy: string;
  /** Email of the steward member; must resolve to an active member, or blank. */
  stewardEmail: string;
  notes: string;
}

/** series.csv — one row per series; sessions are generated from `dates`. */
export interface SeriesCsvRow {
  weekday: string;
  name: string;
  /** Scr | Hcp */
  scoring: string;
  /** Pairs | Teams | Individual */
  format: string;
  /** Integer, or blank. */
  bestOfN: string;
  /** Integer, or blank. */
  bestOfM: string;
  /** Boolean-ish. */
  allowSubstitute: string;
  eligibilityNote: string;
  note: string;
  /** `;`-separated ISO dates, e.g. `2027-01-12;2027-01-19;2027-01-26`. */
  dates: string;
  /** Integer, or blank; ignored unless `format` is `Teams`. Defaults to 4. */
  teamMin?: string;
  /** Integer, or blank; ignored unless `format` is `Teams`. Defaults to 6. */
  teamMax?: string;
}

/** singles.csv — Holiday Bridge / No Bridge one-off dates. */
export interface SingleCsvRow {
  date: string;
  weekday: string;
  /** holidayBridge | noBridge */
  kind: string;
  title: string;
  /** Boolean-ish; ignored for noBridge. */
  partnerRequired: string;
}

/** Outcome of a members import, surfaced to the admin UI. */
export interface MemberImportReport {
  importId: string;
  added: number;
  updated: number;
  deactivated: number;
  unchanged: number;
  errors: CsvRowError[];
  /** Non-fatal notices, e.g. "admin X was absent from the file and was not deactivated". */
  warnings: string[];
}

/** Outcome of a programme import (weekdays + series + singles), per year draft. */
export interface ProgrammeImportReport {
  importId: string;
  year: number;
  weekdays: number;
  series: number;
  sessions: number;
  errors: CsvRowError[];
}

export interface CsvRowError {
  file: 'members' | 'weekdays' | 'series' | 'singles';
  /** 1-based row number in the source file, excluding the header. */
  row: number;
  message: string;
  /** The offending raw values, for display. */
  raw?: Record<string, string>;
}

/** Parsed, validated session date derived from a SeriesCsvRow. */
export interface GeneratedSessionDate {
  date: IsoDate;
  seriesName: string;
}

/**
 * Core of `importProgramme` (plan §5.4, §9.2, §13), factored out of the
 * callable so the seed script (plan §16 Phase 2) can drive the exact same
 * code path instead of duplicating it — mirrors how `provisionMember` is
 * shared between `importMembers` and the seed.
 *
 * Validates weekdays.csv + series.csv + singles.csv *as one unit* before
 * writing anything: every row of every file is checked, deterministic ids
 * are assigned, and cross-file consistency (weekday references, no two
 * sessions on the same date+weekday, date/weekday agreement) is verified. If
 * there are any row errors, or this is a `dryRun`, nothing is written — the
 * report always reflects what *would* happen.
 */
import { randomUUID } from 'node:crypto';
import Papa from 'papaparse';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  SESSION_KINDS,
  assertIsoDate,
  assertTimeOfDay,
  isValidEmail,
  normaliseEmail,
  parseBooleanCell,
  parseDateList,
  parseFormat,
  parseOptionalInt,
  parseScoring,
  parseWeekday,
  paths,
  weekdayOfNZ,
  type CsvRowError,
  type Entry,
  type ImportProgrammeInput,
  type Member,
  type MemberPrivate,
  type ProgrammeImportReport,
  type ScoringType,
  type Series,
  type SeriesFormat,
  type Session,
  type SessionKind,
  type Weekday,
  type WeekdayProgramme,
} from '@obc/shared';
import { db } from '../lib/admin.js';
import { audit } from '../lib/audit.js';
import { BatchWriter } from '../lib/batchWriter.js';
import { assignSeriesIds, sessionIdForSeries, sessionIdForSingle, slugify } from './programmeIds.js';

const MAX_ROWS = 2_000;
const MAX_CELL_LENGTH = 500;
const MAX_REMOVED_DATES_LISTED = 10;

const WEEKDAYS_HEADERS = ['weekday', 'label', 'startTime', 'seatedBy', 'stewardEmail', 'notes'];
const SERIES_HEADERS_BASE = [
  'weekday',
  'name',
  'scoring',
  'format',
  'bestOfN',
  'bestOfM',
  'allowSubstitute',
  'eligibilityNote',
  'note',
  'dates',
];
const SERIES_HEADERS_WITH_TEAMS = [...SERIES_HEADERS_BASE, 'teamMin', 'teamMax'];
const SINGLES_HEADERS = ['date', 'weekday', 'kind', 'title', 'partnerRequired'];

const SINGLE_KINDS = SESSION_KINDS.filter((k) => k !== 'series') as Exclude<SessionKind, 'series'>[];

/* ------------------------------- CSV parsing ------------------------------ */

interface RawRow {
  rowNum: number;
  raw: Record<string, string>;
}

function parseCsvRows(
  csv: string,
  file: CsvRowError['file'],
  headerSets: string[][],
  errors: CsvRowError[],
): RawRow[] {
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  const fields = parsed.meta.fields ?? [];
  const matches = headerSets.some(
    (set) => fields.length === set.length && set.every((f) => fields.includes(f)),
  );
  if (!matches) {
    const expected = headerSets.map((s) => s.join(', ')).join('  OR  ');
    throw new HttpsError(
      'invalid-argument',
      `${file}.csv header must be exactly: ${expected} (got: ${fields.join(', ') || '(none)'})`,
    );
  }
  if (parsed.data.length > MAX_ROWS) {
    throw new HttpsError('invalid-argument', `${file}.csv must have at most ${MAX_ROWS} rows.`);
  }

  const parseErrorRows = new Set<number>();
  for (const e of parsed.errors) {
    if (typeof e.row === 'number') {
      parseErrorRows.add(e.row);
      errors.push({ file, row: e.row + 1, message: e.message });
    }
  }

  const rows: RawRow[] = [];
  parsed.data.forEach((raw, idx) => {
    if (parseErrorRows.has(idx)) return;
    const rowNum = idx + 1;
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string' && value.length > MAX_CELL_LENGTH) {
        errors.push({ file, row: rowNum, message: `${key}: value exceeds ${MAX_CELL_LENGTH} characters`, raw });
        return;
      }
    }
    rows.push({ rowNum, raw });
  });
  return rows;
}

function cell(raw: Record<string, string>, key: string): string {
  return (raw[key] ?? '').trim();
}

/** Every date in `dates` must fall in `year` and land on `weekday` (plan §16 Phase 2, catches transcriptions). */
function checkDatesMatchWeekday(
  dates: string[],
  weekday: Weekday,
  year: number,
  file: CsvRowError['file'],
  rowNum: number,
  raw: Record<string, string>,
  errors: CsvRowError[],
): boolean {
  let ok = true;
  for (const date of dates) {
    if (!date.startsWith(`${year}-`)) {
      errors.push({ file, row: rowNum, message: `date "${date}" is not in ${year}`, raw });
      ok = false;
      continue;
    }
    try {
      const actual = weekdayOfNZ(date);
      if (actual !== weekday) {
        errors.push({
          file,
          row: rowNum,
          message: `date "${date}" is a ${actual}, not a ${weekday} as the row states`,
          raw,
        });
        ok = false;
      }
    } catch (err) {
      errors.push({
        file,
        row: rowNum,
        message: `date "${date}": ${err instanceof Error ? err.message : 'invalid date'}`,
        raw,
      });
      ok = false;
    }
  }
  return ok;
}

/* ------------------------------ weekdays.csv ------------------------------ */

interface ValidWeekdayRow {
  rowNum: number;
  weekday: Weekday;
  label: string;
  startTime: string;
  seatedByTime: string;
  stewardEmailLower: string;
  notes: string;
}

function validateWeekdayRows(rows: RawRow[], errors: CsvRowError[]): ValidWeekdayRow[] {
  const out: ValidWeekdayRow[] = [];
  const seenWeekdays = new Set<Weekday>();
  for (const { rowNum, raw } of rows) {
    try {
      const weekday = parseWeekday(cell(raw, 'weekday'));
      if (seenWeekdays.has(weekday)) {
        throw new Error(`weekday "${weekday}" is duplicated in weekdays.csv`);
      }
      const label = cell(raw, 'label');
      if (!label) throw new Error('label is required');
      const startTime = assertTimeOfDay(cell(raw, 'startTime'), 'startTime');
      const seatedByTime = assertTimeOfDay(cell(raw, 'seatedBy'), 'seatedBy');
      const stewardEmailRaw = cell(raw, 'stewardEmail');
      let stewardEmailLower = '';
      if (stewardEmailRaw) {
        if (!isValidEmail(stewardEmailRaw)) throw new Error(`stewardEmail: "${stewardEmailRaw}" is not a valid email address`);
        stewardEmailLower = normaliseEmail(stewardEmailRaw);
      }
      const notes = cell(raw, 'notes');
      seenWeekdays.add(weekday);
      out.push({ rowNum, weekday, label, startTime, seatedByTime, stewardEmailLower, notes });
    } catch (err) {
      errors.push({ file: 'weekdays', row: rowNum, message: err instanceof Error ? err.message : 'invalid row', raw });
    }
  }
  return out;
}

/** Resolves each row's `stewardEmailLower` to an active member uid; invalidates rows whose steward doesn't resolve. */
async function resolveStewards(
  rows: ValidWeekdayRow[],
  errors: CsvRowError[],
): Promise<Map<number, string | undefined>> {
  const emails = [...new Set(rows.filter((r) => r.stewardEmailLower).map((r) => r.stewardEmailLower))];
  const uidByEmail = new Map<string, string>();
  for (let i = 0; i < emails.length; i += 30) {
    const chunk = emails.slice(i, i + 30);
    const snap = await db.collection('memberPrivate').where('emailLower', 'in', chunk).get();
    for (const doc of snap.docs) {
      uidByEmail.set((doc.data() as MemberPrivate).emailLower, doc.id);
    }
  }
  const uids = [...new Set(uidByEmail.values())];
  const activeUids = new Set<string>();
  if (uids.length) {
    const memberDocs = await db.getAll(...uids.map((u) => db.doc(paths.member(u))));
    for (const snap of memberDocs) {
      const m = snap.data() as Member | undefined;
      if (m?.active) activeUids.add(snap.id);
    }
  }

  const stewardUidByRowNum = new Map<number, string | undefined>();
  for (const row of rows) {
    if (!row.stewardEmailLower) {
      stewardUidByRowNum.set(row.rowNum, undefined);
      continue;
    }
    const uid = uidByEmail.get(row.stewardEmailLower);
    if (!uid || !activeUids.has(uid)) {
      errors.push({
        file: 'weekdays',
        row: row.rowNum,
        message: `stewardEmail: no active member found for "${row.stewardEmailLower}"`,
      });
      continue;
    }
    stewardUidByRowNum.set(row.rowNum, uid);
  }
  return stewardUidByRowNum;
}

/* ------------------------------- series.csv -------------------------------- */

interface ValidSeriesRow {
  rowNum: number;
  weekday: Weekday;
  name: string;
  scoring: ScoringType;
  format: SeriesFormat;
  bestOf: { n: number; m: number } | null;
  allowSubstitute: boolean;
  eligibilityNote: string;
  note: string;
  dates: string[];
  teamMin: number;
  teamMax: number;
}

function validateSeriesRows(
  rows: RawRow[],
  year: number,
  validWeekdaySet: Set<Weekday>,
  errors: CsvRowError[],
): ValidSeriesRow[] {
  const out: ValidSeriesRow[] = [];
  for (const { rowNum, raw } of rows) {
    try {
      const weekday = parseWeekday(cell(raw, 'weekday'));
      if (!validWeekdaySet.has(weekday)) {
        throw new Error(`weekday "${weekday}" has no corresponding row in weekdays.csv`);
      }
      const name = cell(raw, 'name');
      if (!name) throw new Error('name is required');
      const scoring = parseScoring(cell(raw, 'scoring'));
      const format = parseFormat(cell(raw, 'format'));

      const bestOfN = parseOptionalInt(cell(raw, 'bestOfN'), 'bestOfN');
      const bestOfM = parseOptionalInt(cell(raw, 'bestOfM'), 'bestOfM');
      if ((bestOfN === null) !== (bestOfM === null)) {
        throw new Error('bestOfN and bestOfM must both be set or both blank');
      }
      let bestOf: { n: number; m: number } | null = null;
      if (bestOfN !== null && bestOfM !== null) {
        if (bestOfN > bestOfM) throw new Error(`bestOfN (${bestOfN}) must be <= bestOfM (${bestOfM})`);
        bestOf = { n: bestOfN, m: bestOfM };
      }

      const allowSubstitute = parseBooleanCell(cell(raw, 'allowSubstitute'), 'allowSubstitute');
      const eligibilityNote = cell(raw, 'eligibilityNote');
      const note = cell(raw, 'note');
      const dates = parseDateList(cell(raw, 'dates'), 'dates');

      let teamMin = 4;
      let teamMax = 6;
      if (format === 'Teams') {
        teamMin = parseOptionalInt(cell(raw, 'teamMin'), 'teamMin') ?? 4;
        teamMax = parseOptionalInt(cell(raw, 'teamMax'), 'teamMax') ?? 6;
        if (!(teamMin >= 2 && teamMin <= teamMax && teamMax <= 12)) {
          throw new Error(`teamMin/teamMax must satisfy 2 <= teamMin (${teamMin}) <= teamMax (${teamMax}) <= 12`);
        }
      }

      const datesOk = checkDatesMatchWeekday(dates, weekday, year, 'series', rowNum, raw, errors);
      if (!datesOk) continue;

      out.push({ rowNum, weekday, name, scoring, format, bestOf, allowSubstitute, eligibilityNote, note, dates, teamMin, teamMax });
    } catch (err) {
      errors.push({ file: 'series', row: rowNum, message: err instanceof Error ? err.message : 'invalid row', raw });
    }
  }
  return out;
}

/* ------------------------------ singles.csv -------------------------------- */

interface ValidSingleRow {
  rowNum: number;
  date: string;
  weekday: Weekday;
  kind: Exclude<SessionKind, 'series'>;
  title: string;
  partnerRequired: boolean;
}

function validateSingleRows(
  rows: RawRow[],
  year: number,
  validWeekdaySet: Set<Weekday>,
  errors: CsvRowError[],
): ValidSingleRow[] {
  const out: ValidSingleRow[] = [];
  for (const { rowNum, raw } of rows) {
    try {
      const date = assertIsoDate(cell(raw, 'date'), 'date');
      const weekday = parseWeekday(cell(raw, 'weekday'));
      if (!validWeekdaySet.has(weekday)) {
        throw new Error(`weekday "${weekday}" has no corresponding row in weekdays.csv`);
      }
      const kindRaw = cell(raw, 'kind');
      const kind = SINGLE_KINDS.find((k) => k.toLowerCase() === kindRaw.toLowerCase());
      if (!kind) throw new Error(`kind: expected one of ${SINGLE_KINDS.join(', ')}, got "${kindRaw}"`);
      const title = cell(raw, 'title');
      if (!title) throw new Error('title is required');
      const partnerRequired = kind === 'holidayBridge' ? parseBooleanCell(cell(raw, 'partnerRequired'), 'partnerRequired') : false;

      const datesOk = checkDatesMatchWeekday([date], weekday, year, 'singles', rowNum, raw, errors);
      if (!datesOk) continue;

      out.push({ rowNum, date, weekday, kind, title, partnerRequired });
    } catch (err) {
      errors.push({ file: 'singles', row: rowNum, message: err instanceof Error ? err.message : 'invalid row', raw });
    }
  }
  return out;
}

/* --------------------------------- candidates ------------------------------- */

interface CandidateSession {
  id: string;
  date: string;
  weekday: Weekday;
  seriesId: string | null;
  kind: SessionKind;
  title: string;
  partnerRequired: boolean;
  seriesName?: string;
  scoring?: ScoringType;
  format?: SeriesFormat;
  source: { file: CsvRowError['file']; row: number };
}

/** Drops every session sharing a (date, weekday) with another one — plan §16 Phase 2 cross-file check. */
function pruneDateWeekdayCollisions(
  candidates: CandidateSession[],
  errors: CsvRowError[],
): CandidateSession[] {
  const byKey = new Map<string, CandidateSession[]>();
  for (const c of candidates) {
    const key = `${c.date}|${c.weekday}`;
    const list = byKey.get(key) ?? [];
    list.push(c);
    byKey.set(key, list);
  }
  const dropped = new Set<CandidateSession>();
  for (const [, list] of byKey) {
    if (list.length <= 1) continue;
    for (const c of list) {
      dropped.add(c);
      errors.push({
        file: c.source.file,
        row: c.source.row,
        message: `date "${c.date}" (${c.weekday}) is used by more than one session: ${list
          .map((x) => `${x.source.file} row ${x.source.row}`)
          .join(', ')}`,
      });
    }
  }
  return candidates.filter((c) => !dropped.has(c));
}

/* ---------------------------------- main ------------------------------------ */

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function runProgrammeImport(
  input: ImportProgrammeInput,
  actorMemberId: string,
): Promise<ProgrammeImportReport> {
  const { year } = input;
  const importId = randomUUID();
  const warnings: string[] = [];
  const errors: CsvRowError[] = [];

  const existingProgrammeSnap = await db.doc(paths.programme(year)).get();
  const existingProgramme = existingProgrammeSnap.data() as { status?: 'draft' | 'published' } | undefined;

  if (existingProgramme?.status === 'published' && !input.replace) {
    throw new HttpsError(
      'failed-precondition',
      `Programme ${year} is already published. Pass replace: true to re-import over it.`,
    );
  }

  // ---- parse + per-row validation ----
  const weekdayRawRows = parseCsvRows(input.weekdaysCsv, 'weekdays', [WEEKDAYS_HEADERS], errors);
  const validWeekdayRows = validateWeekdayRows(weekdayRawRows, errors);
  const stewardUidByRowNum = await resolveStewards(validWeekdayRows, errors);
  const finalWeekdayRows = validWeekdayRows.filter((r) => {
    // A row is only dropped here if resolveStewards pushed an error for it
    // (i.e. it has a non-blank steward email that failed to resolve).
    return !(r.stewardEmailLower && stewardUidByRowNum.get(r.rowNum) === undefined);
  });
  const validWeekdaySet = new Set<Weekday>(finalWeekdayRows.map((r) => r.weekday));

  const seriesRawRows = parseCsvRows(input.seriesCsv, 'series', [SERIES_HEADERS_BASE, SERIES_HEADERS_WITH_TEAMS], errors);
  const validSeriesRows = validateSeriesRows(seriesRawRows, year, validWeekdaySet, errors);

  const singlesRawRows = parseCsvRows(input.singlesCsv, 'singles', [SINGLES_HEADERS], errors);
  const validSingleRows = validateSingleRows(singlesRawRows, year, validWeekdaySet, errors);

  // ---- deterministic ids + candidate sessions ----
  const seriesIds = assignSeriesIds(validSeriesRows.map((r) => ({ weekday: r.weekday, name: r.name })));
  for (let i = 0; i < validSeriesRows.length; i++) {
    const row = validSeriesRows[i]!;
    const undisambiguatedBase = `${row.weekday}-${slugify(row.name)}`;
    if (seriesIds[i] !== undisambiguatedBase) {
      warnings.push(
        `series row ${row.rowNum} ("${row.name}") shares its ${row.weekday} slug with an earlier series; assigned id "${seriesIds[i]}".`,
      );
    }
  }

  let candidateSessions: CandidateSession[] = [];
  const orderByWeekday = new Map<Weekday, number>();
  const seriesDocs: Series[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < validSeriesRows.length; i++) {
    const row = validSeriesRows[i]!;
    const id = seriesIds[i]!;
    const order = orderByWeekday.get(row.weekday) ?? 0;
    orderByWeekday.set(row.weekday, order + 1);

    const sessionIds = row.dates.map((date) => sessionIdForSeries(id, date));
    for (let d = 0; d < row.dates.length; d++) {
      candidateSessions.push({
        id: sessionIds[d]!,
        date: row.dates[d]!,
        weekday: row.weekday,
        seriesId: id,
        kind: 'series',
        title: row.name,
        // Pairs and Individual series both need a partner arranged by the member
        // (Individual just rotates partners week to week, plan §2). Teams series
        // are entered via a team, not a partner (plan §12A).
        partnerRequired: row.format !== 'Teams',
        seriesName: row.name,
        scoring: row.scoring,
        format: row.format,
        source: { file: 'series', row: row.rowNum },
      });
    }

    seriesDocs.push({
      id,
      weekday: row.weekday,
      name: row.name,
      scoring: row.scoring,
      format: row.format,
      bestOf: row.bestOf,
      allowSubstitute: row.allowSubstitute,
      eligibilityNote: row.eligibilityNote || undefined,
      generalNote: row.note || undefined,
      order,
      sessionIds: [...sessionIds].sort(),
      teamMin: row.teamMin,
      teamMax: row.teamMax,
      createdAt: now,
      updatedAt: now,
    });
  }

  for (const row of validSingleRows) {
    candidateSessions.push({
      id: sessionIdForSingle(year, row.date, row.weekday),
      date: row.date,
      weekday: row.weekday,
      seriesId: null,
      kind: row.kind,
      title: row.title,
      partnerRequired: row.partnerRequired,
      source: { file: 'singles', row: row.rowNum },
    });
  }

  candidateSessions = pruneDateWeekdayCollisions(candidateSessions, errors);
  const survivingIds = new Set(candidateSessions.map((c) => c.id));
  // Drop any series-doc sessionIds that were pruned as a date/weekday collision.
  for (const s of seriesDocs) {
    s.sessionIds = s.sessionIds.filter((id) => survivingIds.has(id));
  }

  // ---- replace-safety check (existing published programme only) ----
  let wouldRemoveSessions = 0;
  if (existingProgramme) {
    const existingSessionsSnap = await db.collection(paths.sessions(year)).get();
    const existingIds = existingSessionsSnap.docs.map((d) => d.id);
    const newIds = new Set(candidateSessions.map((c) => c.id));
    const removedIds = existingIds.filter((id) => !newIds.has(id));
    wouldRemoveSessions = removedIds.length;

    if (existingProgramme.status === 'published' && removedIds.length > 0 && errors.length === 0) {
      const nonCancelledDates: string[] = [];
      for (const idBatch of chunk(removedIds, 30)) {
        const snap = await db.collection('entries').where('sessionId', 'in', idBatch).get();
        for (const doc of snap.docs) {
          const entry = doc.data() as Entry;
          if (entry.status !== 'cancelled') {
            nonCancelledDates.push(`${entry.date} (${entry.sessionId})`);
          }
        }
      }
      if (nonCancelledDates.length > 0) {
        const listed = [...new Set(nonCancelledDates)].slice(0, MAX_REMOVED_DATES_LISTED);
        throw new HttpsError(
          'failed-precondition',
          `Replacing programme ${year} would remove ${removedIds.length} session(s) with active entries: ${listed.join(', ')}${
            nonCancelledDates.length > MAX_REMOVED_DATES_LISTED ? ', …' : ''
          }. Cancel those entries first.`,
        );
      }
    }
    if (removedIds.length > 0) {
      warnings.push(`This import removes ${removedIds.length} session(s) that existed in the current ${year} programme.`);
    }
  }

  const weekdaysCount = finalWeekdayRows.length;
  const seriesCount = seriesDocs.length;
  const sessionsCount = candidateSessions.length;

  const report: ProgrammeImportReport = {
    importId,
    year,
    weekdays: weekdaysCount,
    series: seriesCount,
    sessions: sessionsCount,
    errors,
    warnings,
    wouldRemoveSessions,
  };

  if (errors.length > 0 || input.dryRun) {
    return report;
  }

  // ---- write ----
  const writer = new BatchWriter();
  const startedAt = new Date().toISOString();

  if (existingProgramme) {
    const [existingWeekdays, existingSeries, existingSessions] = await Promise.all([
      db.collection(paths.weekdays(year)).get(),
      db.collection(paths.series(year)).get(),
      db.collection(paths.sessions(year)).get(),
    ]);
    for (const d of existingWeekdays.docs) writer.delete(d.ref);
    for (const d of existingSeries.docs) writer.delete(d.ref);
    for (const d of existingSessions.docs) writer.delete(d.ref);
  }

  const programmeStatus = existingProgramme?.status ?? 'draft';
  writer.set(
    db.doc(paths.programme(year)),
    {
      id: String(year),
      year,
      status: programmeStatus,
      importedAt: now,
      createdAt: existingProgrammeSnap.exists ? (existingProgrammeSnap.data() as { createdAt?: string }).createdAt ?? now : now,
      updatedAt: now,
    },
    { merge: true },
  );

  for (const row of finalWeekdayRows) {
    const doc: WeekdayProgramme = {
      id: row.weekday,
      weekday: row.weekday,
      label: row.label,
      startTime: row.startTime,
      seatedByTime: row.seatedByTime,
      partnerStewardMemberId: stewardUidByRowNum.get(row.rowNum),
      notes: row.notes || undefined,
      createdAt: now,
      updatedAt: now,
    };
    writer.set(db.doc(paths.weekday(year, row.weekday)), doc);
  }

  for (const s of seriesDocs) {
    writer.set(db.doc(paths.seriesDoc(year, s.id)), s);
  }

  for (const c of candidateSessions) {
    const doc: Session = {
      id: c.id,
      date: c.date,
      weekday: c.weekday,
      seriesId: c.seriesId,
      kind: c.kind,
      title: c.title,
      partnerRequired: c.partnerRequired,
      seriesName: c.seriesName,
      scoring: c.scoring,
      format: c.format,
      createdAt: now,
      updatedAt: now,
    };
    writer.set(db.doc(paths.session(year, c.id)), doc);
  }

  await writer.flush();

  await db.doc(paths.import(importId)).set({
    id: importId,
    kind: 'programme',
    actorMemberId,
    startedAt,
    finishedAt: new Date().toISOString(),
    report,
  });

  await audit({
    actorMemberId,
    action: 'programme_import',
    entityRef: paths.programme(year),
    detail: {
      year,
      weekdays: weekdaysCount,
      series: seriesCount,
      sessions: sessionsCount,
      replaced: !!existingProgramme,
    },
  });

  return report;
}

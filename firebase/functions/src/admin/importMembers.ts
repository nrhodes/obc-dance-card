/**
 * `importMembers` (plan §8.2 "Provisioning (admin)", §9.2, §13). Admin-only.
 * Validates the whole file first (collecting per-row errors), then — unless
 * `dryRun` — provisions every valid row via `provisionMember` and
 * deactivates any active member absent from the file (never an admin, never
 * a delete).
 */
import { randomUUID } from 'node:crypto';
import Papa from 'papaparse';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  ImportMembersInputSchema,
  isValidEmail,
  normaliseEmail,
  parseGrade,
  paths,
  type CsvRowError,
  type ImportMembersInput,
  type Member,
  type MemberGrade,
  type MemberImportReport,
  type MemberPrivate,
} from '@obc/shared';
import { auth, db } from '../lib/admin.js';
import { callableOptions } from '../lib/callable.js';
import { requireAdmin } from '../lib/context.js';
import { audit } from '../lib/audit.js';
import { BatchWriter } from '../lib/batchWriter.js';
import { provisionMember } from './provisionMember.js';
import { promoteVisitorsForNewMember } from '../visitors/promotion.js';
import { parseInput } from '../lib/parseInput.js';

const EXPECTED_HEADERS = ['firstName', 'lastName', 'email', 'phone', 'grade'];
const MAX_ROWS = 2_000;
const MAX_CELL_LENGTH = 500;

interface ValidRow {
  rowNum: number;
  firstName: string;
  lastName: string;
  emailLower: string;
  phone: string;
  grade: MemberGrade;
}

/** Absolute floor for the mass-deactivation guard (see importMembersHandler). */
const MASS_DEACTIVATION_FLOOR = 5;
/** Fraction of currently-active members above which deactivation is refused without opt-in. */
const MASS_DEACTIVATION_FRACTION = 0.2;

function parseAndValidateCsv(csv: string): {
  rows: ValidRow[];
  errors: CsvRowError[];
  /** Every syntactically-valid email that appears anywhere in the file, including on rows that errored. */
  mentionedEmails: Set<string>;
} {
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });

  const fields = parsed.meta.fields ?? [];
  const hasExactHeaders =
    fields.length === EXPECTED_HEADERS.length && EXPECTED_HEADERS.every((f) => fields.includes(f));
  if (!hasExactHeaders) {
    throw new HttpsError(
      'invalid-argument',
      `members.csv header must be exactly: ${EXPECTED_HEADERS.join(', ')} (got: ${fields.join(', ') || '(none)'})`,
    );
  }

  if (parsed.data.length > MAX_ROWS) {
    throw new HttpsError('invalid-argument', `members.csv must have at most ${MAX_ROWS} rows.`);
  }

  const errors: CsvRowError[] = [];
  const parseErrorRows = new Set<number>();
  for (const e of parsed.errors) {
    if (typeof e.row === 'number') {
      parseErrorRows.add(e.row);
      errors.push({ file: 'members', row: e.row + 1, message: e.message });
    }
  }

  interface Candidate {
    rowNum: number;
    firstName: string;
    lastName: string;
    emailLower: string;
    phone: string;
    grade: MemberGrade;
    raw: Record<string, string>;
  }
  const candidates: Candidate[] = [];
  const mentionedEmails = new Set<string>();

  parsed.data.forEach((raw, idx) => {
    if (parseErrorRows.has(idx)) return;
    const rowNum = idx + 1;

    // Record the email *before* any validation can reject the row, so a
    // member whose row is malformed is still "present" for deactivation
    // purposes.
    const mentioned = (raw.email ?? '').trim();
    if (mentioned && isValidEmail(mentioned)) mentionedEmails.add(normaliseEmail(mentioned));

    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string' && value.length > MAX_CELL_LENGTH) {
        errors.push({ file: 'members', row: rowNum, message: `${key}: value exceeds ${MAX_CELL_LENGTH} characters`, raw });
        return;
      }
    }

    const firstName = (raw.firstName ?? '').trim();
    const lastName = (raw.lastName ?? '').trim();
    const emailRaw = (raw.email ?? '').trim();
    const phone = (raw.phone ?? '').trim();

    if (!firstName) {
      errors.push({ file: 'members', row: rowNum, message: 'firstName is required', raw });
      return;
    }
    if (!lastName) {
      errors.push({ file: 'members', row: rowNum, message: 'lastName is required', raw });
      return;
    }
    if (!emailRaw || !isValidEmail(emailRaw)) {
      errors.push({ file: 'members', row: rowNum, message: `email: "${emailRaw}" is not a valid email address`, raw });
      return;
    }

    candidates.push({
      rowNum,
      firstName,
      lastName,
      emailLower: normaliseEmail(emailRaw),
      phone,
      grade: parseGrade(raw.grade ?? ''),
      raw,
    });
  });

  const emailCounts = new Map<string, number>();
  for (const c of candidates) emailCounts.set(c.emailLower, (emailCounts.get(c.emailLower) ?? 0) + 1);

  const rows: ValidRow[] = [];
  for (const c of candidates) {
    if ((emailCounts.get(c.emailLower) ?? 0) > 1) {
      errors.push({ file: 'members', row: c.rowNum, message: `email "${c.emailLower}" is duplicated in this file`, raw: c.raw });
      continue;
    }
    rows.push({ rowNum: c.rowNum, firstName: c.firstName, lastName: c.lastName, emailLower: c.emailLower, phone: c.phone, grade: c.grade });
  }

  return { rows, errors, mentionedEmails };
}

export async function importMembersHandler(req: CallableRequest<ImportMembersInput>): Promise<MemberImportReport> {
  const input = parseInput(ImportMembersInputSchema, req.data);
  const caller = await requireAdmin(req);

  const { rows, errors, mentionedEmails } = parseAndValidateCsv(input.csv);
  // Deactivation is keyed on "absent from the file", and must never be
  // triggered by a row that merely failed validation (blank surname, duplicate,
  // ...). So the protected set is every email *mentioned*, not every valid row.
  const fileEmails = mentionedEmails;

  const importId = randomUUID();
  const startedAt = new Date().toISOString();
  const warnings: string[] = [];
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let deactivated = 0;

  const writer = input.dryRun ? undefined : new BatchWriter();

  for (const row of rows) {
    try {
      const result = await provisionMember(
        { firstName: row.firstName, lastName: row.lastName, emailLower: row.emailLower, phone: row.phone, grade: row.grade },
        { dryRun: !!input.dryRun, writer },
      );
      if (result.outcome === 'added') {
        added++;
        // Plan §12.5: promote any visitor whose email matches this brand-new
        // member. Never during a dry run (no member was actually created —
        // `result.memberId` is null in that case too).
        if (!input.dryRun && result.memberId) {
          await promoteVisitorsForNewMember(result.memberId, row.emailLower, caller.uid);
        }
      } else if (result.outcome === 'updated') updated++;
      else unchanged++;
    } catch (err) {
      errors.push({
        file: 'members',
        row: row.rowNum,
        message: err instanceof Error ? err.message : 'unknown provisioning error',
      });
    }
  }

  // Members present in Firestore but absent from the file: deactivate
  // (never delete, never an admin). Two passes: first collect candidates, then
  // apply — so a wrong/partial file cannot wipe out the club in one click.
  const allPrivateSnap = await db.collection('memberPrivate').get();
  const toDeactivate: Array<{ uid: string; memberRef: FirebaseFirestore.DocumentReference }> = [];
  let activeCount = 0;
  for (const privateDoc of allPrivateSnap.docs) {
    const emailLower = (privateDoc.data() as MemberPrivate).emailLower;
    const uid = privateDoc.id;
    const memberRef = db.doc(paths.member(uid));
    const memberSnap = await memberRef.get();
    const member = memberSnap.data() as Member | undefined;
    if (!member || member.active !== true) continue; // already inactive: no-op
    activeCount++;
    if (fileEmails.has(emailLower)) continue;

    if (member.role === 'admin') {
      warnings.push(
        `Member ${uid} (${member.firstName} ${member.lastName}) is an admin absent from the import file — not deactivated. Deactivate manually via setMemberRole/deactivateMember if intended.`,
      );
      continue;
    }
    toDeactivate.push({ uid, memberRef });
  }

  const massThreshold = Math.max(MASS_DEACTIVATION_FLOOR, Math.ceil(activeCount * MASS_DEACTIVATION_FRACTION));
  if (toDeactivate.length > massThreshold && !input.allowMassDeactivation) {
    warnings.push(
      `This file would deactivate ${toDeactivate.length} of ${activeCount} active members (threshold ${massThreshold}). ` +
        'No one was deactivated. If this is intended, re-run with allowMassDeactivation: true.',
    );
    toDeactivate.length = 0;
  }

  for (const { uid, memberRef } of toDeactivate) {
    try {
      if (!input.dryRun) {
        writer!.update(memberRef, { active: false, updatedAt: new Date().toISOString() });
        await auth.updateUser(uid, { disabled: true });
        await auth.revokeRefreshTokens(uid);
      }
      deactivated++;
    } catch (err) {
      warnings.push(
        `Failed to deactivate member ${uid}: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }

  if (writer) await writer.flush();

  const report: MemberImportReport = { importId, added, updated, deactivated, unchanged, errors, warnings };

  if (!input.dryRun) {
    await db.doc(paths.import(importId)).set({
      id: importId,
      kind: 'members',
      actorMemberId: caller.uid,
      startedAt,
      finishedAt: new Date().toISOString(),
      report,
    });

    await audit({
      actorMemberId: caller.uid,
      action: 'member_import',
      entityRef: paths.import(importId),
      detail: { added, updated, deactivated, unchanged, errorCount: errors.length, warningCount: warnings.length },
    });
  }

  return report;
}

export const importMembers = onCall({ ...callableOptions, timeoutSeconds: 300 }, importMembersHandler);

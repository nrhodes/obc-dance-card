/**
 * `setBulkSoloStatus` (plan §21 B2 "I never play Mondays", settled design
 * superseding the plan's original sketch): set a solo status — `available`,
 * `unavailable`, or `clear` (back to no listing) — across every matching
 * session in one call, filtered by weekday and an optional date range.
 *
 * Scope, exactly as settled:
 *  - Every *published* programme year is searched (there is no cross-year
 *    index for `sessions` — only a single-collection `(weekday, date)` index,
 *    plan §5.4/§9 — so this iterates published years one at a time, exactly
 *    like every other multi-year listing in this codebase would have to).
 *  - `date >= max(filter.fromDate, todayNZ())`, `date <= filter.toDate` (no
 *    upper bound when absent), `kind !== 'noBridge'`, and not locked (§6/I7).
 *  - A **booked** entry (`confirmed`/`substituted`, which covers a Teams
 *    member's `teamId`-bearing `confirmed` entry too — plan §5.6) is never
 *    touched: it is reported in `skipped`, never overwritten.
 *  - A solo entry (`looking_for_partner`/`available`/`unavailable`),
 *    `cancelled`, or absent entry is freely upserted to the new status (or,
 *    for `'clear'`, flipped to `cancelled` — entries are never deleted).
 *
 * `expandBulkSoloStatusSessions` is deliberately pure (no Firestore) so the
 * 200-session cap and the weekday/date/kind/lock filtering are unit-testable
 * without the emulator (`bulkSoloStatus.test.ts`); the callable below does
 * all the I/O (inside one transaction — reads then writes, plan §3 rule 4)
 * and calls it once per invocation.
 */
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import {
  SetBulkSoloStatusInputSchema,
  paths,
  todayNZ,
  type BulkSoloStatusFilter,
  type BulkSoloStatusSkip,
  type Entry,
  type Programme,
  type SetBulkSoloStatusInput,
  type SetBulkSoloStatusResult,
  type Session,
  type WeekdayProgramme,
} from '@obc/shared';
import { db } from '../lib/admin.js';
import { audit } from '../lib/audit.js';
import { callableOptions } from '../lib/callable.js';
import { requireMember, resolveActingMember } from '../lib/context.js';
import { parseInput } from '../lib/parseInput.js';
import { assertRateLimit } from '../lib/rateLimit.js';
import { createNotification } from '../notifications/create.js';
import { entryId, isBooked, isSessionLocked, readEntry, soloStatusLabel } from './lib.js';

const BULK_SOLO_STATUS_LIMIT = 20;
const BULK_SOLO_STATUS_WINDOW_SEC = 24 * 3600;

/** Cap on how many sessions one call may touch (settled design). Exported so the emu/unit tests can assert against the exact boundary. */
export const MAX_BULK_SOLO_STATUS_SESSIONS = 200;

export interface BulkSoloStatusCandidate {
  session: Session;
  /** `session.weekday`'s programme, for the lock check — same year as `session`. */
  weekday: WeekdayProgramme;
}

/**
 * Pure: narrows `candidates` (every session from every published year whose
 * `weekday` is one the caller asked about — the callable below does that
 * coarse fetch) down to the exact target set — `date` in range, bookable
 * (`kind !== 'noBridge'`), and unlocked at `now` — and enforces the
 * `MAX_BULK_SOLO_STATUS_SESSIONS` cap. No I/O; safe to unit-test directly.
 */
export function expandBulkSoloStatusSessions(
  candidates: readonly BulkSoloStatusCandidate[],
  filter: BulkSoloStatusFilter,
  today: string,
  now: number = Date.now(),
): Session[] {
  const weekdays = new Set<string>(filter.weekdays);
  const from = filter.fromDate && filter.fromDate > today ? filter.fromDate : today;

  const matched = candidates
    .filter((c) => weekdays.has(c.session.weekday))
    .filter((c) => c.session.date >= from)
    .filter((c) => !filter.toDate || c.session.date <= filter.toDate)
    .filter((c) => c.session.kind !== 'noBridge')
    .filter((c) => !isSessionLocked(c.session, c.weekday, now))
    .map((c) => c.session);

  if (matched.length > MAX_BULK_SOLO_STATUS_SESSIONS) {
    throw new HttpsError(
      'failed-precondition',
      `That matches more than ${MAX_BULK_SOLO_STATUS_SESSIONS} sessions — narrow the date range and try again.`,
    );
  }

  return matched.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));
}

/**
 * Every candidate session (session doc + its year's weekday-programme doc)
 * across every published programme year, restricted to `filter.weekdays` —
 * the coarse, transaction-scoped fetch `expandBulkSoloStatusSessions` then
 * filters precisely. All reads go through `tx.get`, including the queries,
 * so this stays inside the callable's single transaction.
 */
async function loadCandidates(
  tx: FirebaseFirestore.Transaction,
  filter: BulkSoloStatusFilter,
  today: string,
): Promise<BulkSoloStatusCandidate[]> {
  const programmesSnap = await tx.get(db.collection(paths.programmes()).where('status', '==', 'published'));
  const programmes = programmesSnap.docs.map((d) => d.data() as Programme);

  const effectiveFrom = filter.fromDate && filter.fromDate > today ? filter.fromDate : today;

  const candidates: BulkSoloStatusCandidate[] = [];
  for (const programme of programmes) {
    let sessionsQuery = db
      .collection(paths.sessions(programme.year))
      .where('weekday', 'in', filter.weekdays)
      .where('date', '>=', effectiveFrom);
    if (filter.toDate) {
      sessionsQuery = sessionsQuery.where('date', '<=', filter.toDate);
    }
    const sessionsSnap = await tx.get(sessionsQuery);
    if (sessionsSnap.empty) continue;

    const sessions = sessionsSnap.docs.map((d) => d.data() as Session);
    const weekdaysSeen = [...new Set(sessions.map((s) => s.weekday))];
    const weekdayDocs = new Map<string, WeekdayProgramme>();
    for (const wd of weekdaysSeen) {
      const wdSnap = await tx.get(db.doc(paths.weekday(programme.year, wd)));
      const wdDoc = wdSnap.data() as WeekdayProgramme | undefined;
      // Defensive only — every session's `weekday` should always have a
      // matching weekday-programme doc in the same published year; skip
      // (rather than throw) if that is ever not the case, so one bad row
      // cannot break the whole bulk action.
      if (wdDoc) weekdayDocs.set(wd, wdDoc);
    }

    for (const session of sessions) {
      const weekday = weekdayDocs.get(session.weekday);
      if (weekday) candidates.push({ session, weekday });
    }
  }
  return candidates;
}

export async function setBulkSoloStatusHandler(
  req: CallableRequest<SetBulkSoloStatusInput>,
): Promise<SetBulkSoloStatusResult> {
  const input = parseInput(SetBulkSoloStatusInputSchema, req.data);
  const caller = await requireMember(req);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);

  await assertRateLimit('entries:setBulkSoloStatus', actor.memberId, BULK_SOLO_STATUS_LIMIT, BULK_SOLO_STATUS_WINDOW_SEC);

  const result = await db.runTransaction(async (tx) => {
    const today = todayNZ();
    const candidates = await loadCandidates(tx, input.filter, today);
    const targetSessions = expandBulkSoloStatusSessions(candidates, input.filter, today);

    // Firestore transactions require every read before any write — so every
    // `readEntry` happens first, in this pass; the second pass below only
    // calls `tx.set` (plan §3 rule 4: "re-read every document you assert on
    // *inside* the transaction", here done for the whole target set up front).
    const existingBySession = new Map<string, Entry | null>();
    for (const session of targetSessions) {
      existingBySession.set(session.id, await readEntry(tx, session.id, actor.memberId));
    }

    const skipped: BulkSoloStatusSkip[] = [];
    let updated = 0;
    const now = new Date().toISOString();

    for (const session of targetSessions) {
      const existing = existingBySession.get(session.id) ?? null;

      if (isBooked(existing)) {
        skipped.push({ sessionId: session.id, date: session.date, reason: 'booked' });
        continue;
      }

      if (input.status === 'clear') {
        if (existing && existing.status !== 'cancelled') {
          const cancelled: Entry = { ...existing, status: 'cancelled', updatedAt: now };
          tx.set(db.doc(paths.entry(existing.id)), cancelled);
          updated += 1;
        }
        continue;
      }

      const doc: Entry = {
        id: entryId(session.id, actor.memberId),
        sessionId: session.id,
        date: session.date,
        weekday: session.weekday,
        seriesId: session.seriesId,
        memberId: actor.memberId,
        cohort: actor.member.cohort,
        status: input.status,
        partner: null,
        pairingId: null,
        teamId: null,
        teamSessionOnly: false,
        substitute: null,
        partnerSubstitute: null,
        isSubstituteFor: null,
        createdBy: caller.uid,
        onBehalfBy: actor.onBehalfBy,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      tx.set(db.doc(paths.entry(doc.id)), doc);
      updated += 1;
    }

    return { updated, skipped };
  });

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'set_bulk_solo_status_on_behalf',
      targetMemberId: actor.memberId,
      detail: { status: input.status, updated: result.updated, skipped: result.skipped.length },
    });
    const label = input.status === 'clear' ? 'cleared' : soloStatusLabel(input.status);
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin updated your availability',
      `An admin set ${result.updated} session(s) to "${label}" on your behalf.`,
      { count: String(result.updated) },
    );
  }

  return result;
}

export const setBulkSoloStatus = onCall(callableOptions, setBulkSoloStatusHandler);

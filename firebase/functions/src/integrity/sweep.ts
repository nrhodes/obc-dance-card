/**
 * Nightly pairing/team integrity sweep (plan §7 "law", §9.2 `runPairingSweep`
 * row, §9.2 scheduled `verifyPairingConsistency`, §16 Phase 6).
 *
 * Three exported shapes, deliberately kept separate:
 *  - `runPairingSweep(opts)` — the plain, directly-callable core. No
 *    `CallableRequest`/`onCall` involved, so tests can call it exactly like
 *    `runPublishProgramme`/`runProgrammeImport`/`runSendSessionReminders` —
 *    the established pattern in this codebase for "scheduled-job logic that
 *    also needs a deterministic unit test".
 *  - `verifyPairingConsistency` — the `onSchedule` job (03:00 Pacific/Auckland
 *    daily) that calls it with `repair` gated on `PAIRING_SWEEP_REPAIR`.
 *  - `runPairingSweepCallable` — the admin `onCall` wrapper. Deployed under
 *    the name `runPairingSweep` from `index.ts` (plan §9.2's canonical
 *    callable name) — aliased on export there so the *deployed* callable
 *    matches the plan while this module can still export a plain function of
 *    that same name for tests, matching every other `runXxx` in this
 *    codebase.
 *
 * Scope (exactly as specified): every entry with `date >= todayNZ()`,
 * grouped by `sessionId`, checked with `validatePairingGroup`; every
 * non-disbanded team with at least one future session, checked with
 * `validateTeamGroup`.
 *
 * Repair is deliberately narrow and conservative — see the three `repairXxx`
 * helpers below for exactly what each does and does not touch. Anything not
 * matched by one of those shapes is reported but left alone ("anything else
 * → report only").
 */
import { randomUUID } from 'node:crypto';
import {
  RunPairingSweepInputSchema,
  paths,
  todayNZ,
  validatePairingGroup,
  validateTeamGroup,
  type Entry,
  type IntegrityRun,
  type IntegrityViolation,
  type PartnerRef,
  type RunPairingSweepInput,
  type RunPairingSweepResult,
  type Series,
  type Session,
  type Team,
} from '@obc/shared';
import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../lib/admin.js';
import { audit } from '../lib/audit.js';
import { callableOptions } from '../lib/callable.js';
import { requireAdmin } from '../lib/context.js';
import { logger } from '../lib/logger.js';
import { parseInput } from '../lib/parseInput.js';
import { entryId } from '../entries/lib.js';
import { createNotification } from '../notifications/create.js';

const REGION = 'australia-southeast1';
const NZ_TIME_ZONE = 'Pacific/Auckland';

/** Every non-cancelled entry in `entries` for `memberId`, or `undefined`. */
function activeEntryOf(entries: Entry[], memberId: string): Entry | undefined {
  return entries.find((e) => e.memberId === memberId && e.status !== 'cancelled');
}

/**
 * Applies `patch` to `entries/{id}` inside a fresh transaction (re-reading
 * the doc, so a concurrent write since detection is never clobbered blindly)
 * and audits the before/after. Returns `false` (no-op) if the doc has since
 * been deleted.
 */
async function repairEntryDoc(
  id: string,
  patch: Partial<Entry>,
  actorMemberId: string,
): Promise<{ before: Entry; after: Entry } | null> {
  const ref = db.doc(paths.entry(id));
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const entry = snap.data() as Entry | undefined;
    if (!entry) return null;
    const now = new Date().toISOString();
    const after: Entry = { ...entry, ...patch, updatedAt: now };
    tx.set(ref, after);
    return { before: entry, after };
  });
  if (!outcome) return null;
  await audit({
    actorMemberId,
    action: 'pairing_repair',
    entityRef: ref.path,
    before: outcome.before,
    after: outcome.after,
  });
  return outcome;
}

/**
 * Repairs one session's worth of violating entries (plan task brief §D):
 *  - R1 "one-sided / mismatched pairing": a non-cancelled entry claims a
 *    member partner whose mirror is missing, cancelled, or does not (or no
 *    longer) point back with a matching `pairingId`. Repaired by reverting
 *    that side to `looking_for_partner` (I6 shape) and notifying its owner.
 *    Deliberately skips a substitute's own entry (`isSubstituteFor` set) —
 *    those follow I4's different mirroring rule, not I2's, and are left to
 *    the orphan-field pass below (or reported only, if still unresolved).
 *  - Orphan substitution fields: any of `substitute` / `partnerSubstitute` /
 *    `isSubstituteFor` set without the I4 shape that would justify it. Just
 *    cleared — no notification (plan task brief: "orphan substitution
 *    fields → clear them").
 * Anything not covered by R1 or the orphan-field pass is left as a reported,
 * unrepaired violation.
 */
async function repairSessionEntries(entries: Entry[], actorMemberId: string): Promise<number> {
  let repaired = 0;
  const nonCancelled = entries.filter((e) => e.status !== 'cancelled');
  const mirrorBroken = new Set<string>();

  // ---- R1: one-sided / mismatched pairing ----
  for (const e of nonCancelled) {
    if (e.partner?.kind !== 'member' || e.isSubstituteFor) continue;
    const mirror = activeEntryOf(nonCancelled, e.partner.memberId);
    const ok = !!mirror && mirror.partner?.kind === 'member' && mirror.partner.memberId === e.memberId && mirror.pairingId === e.pairingId;
    if (!ok) mirrorBroken.add(e.id);
  }
  for (const id of mirrorBroken) {
    const e = nonCancelled.find((x) => x.id === id)!;
    const outcome = await repairEntryDoc(
      id,
      {
        status: 'looking_for_partner',
        partner: null,
        pairingId: null,
        substitute: null,
        partnerSubstitute: null,
        isSubstituteFor: null,
        note: undefined,
      },
      actorMemberId,
    );
    if (!outcome) continue;
    repaired += 1;
    await createNotification(
      e.memberId,
      'partner_cancelled',
      'We found a problem with your pairing',
      `We found a problem with your pairing for ${e.date}; you're now listed as looking for a partner.`,
      { sessionId: e.sessionId },
    );
  }

  // ---- orphan substitution fields ----
  for (const e of nonCancelled) {
    if (mirrorBroken.has(e.id)) continue;
    const patch: Partial<Entry> = {};

    if (e.substitute !== null && e.status !== 'substituted') {
      patch.substitute = null;
    }
    if (e.partnerSubstitute !== null) {
      const mirror = e.partner?.kind === 'member' ? activeEntryOf(nonCancelled, e.partner.memberId) : undefined;
      if (!mirror || mirror.status !== 'substituted') patch.partnerSubstitute = null;
    }
    if (e.isSubstituteFor !== null) {
      const covered = activeEntryOf(nonCancelled, e.isSubstituteFor);
      const validSub =
        !!covered &&
        covered.status === 'substituted' &&
        covered.substitute?.kind === 'member' &&
        covered.substitute.memberId === e.memberId;
      if (!validSub) patch.isSubstituteFor = null;
    }
    if (e.status !== 'confirmed' && e.status !== 'substituted' && (e.partner !== null || e.pairingId !== null)) {
      // Solo statuses (I6) must have neither — belt-and-braces beyond the
      // substitution-field cleanup above.
      patch.partner = null;
      patch.pairingId = null;
    }

    if (Object.keys(patch).length > 0) {
      const outcome = await repairEntryDoc(e.id, patch, actorMemberId);
      if (outcome) repaired += 1;
    }
  }

  return repaired;
}

/** Every entry tagged `teamId` (any session, any status). */
async function loadAllTeamEntries(teamId: string): Promise<Entry[]> {
  const snap = await db.collection(paths.entries()).where('teamId', '==', teamId).get();
  return snap.docs.map((d) => d.data() as Entry);
}

/** `team`'s series plus its sessions dated `>= today` — the sweep's "future sessions" scope. */
async function loadFutureTeamContext(team: Team, today: string): Promise<{ series: Series | null; futureSessions: Session[] }> {
  const seriesSnap = await db.doc(paths.seriesDoc(team.year, team.seriesId)).get();
  const series = (seriesSnap.data() as Series | undefined) ?? null;
  if (!series) return { series: null, futureSessions: [] };
  const sessions: Session[] = [];
  for (const sessionId of series.sessionIds) {
    const snap = await db.doc(paths.session(team.year, sessionId)).get();
    const session = snap.data() as Session | undefined;
    if (session && session.date >= today) sessions.push(session);
  }
  return { series, futureSessions: sessions };
}

/**
 * Repairs I9 roster/entry mismatches (plan task brief §D): creates the
 * missing `confirmed` team entry for a rostered member who has none on a
 * future session, and cancels a non-cancelled team entry belonging to a
 * member no longer on the roster. No notifications (not specified).
 */
async function repairTeam(team: Team, futureSessions: Session[], allEntries: Entry[], actorMemberId: string): Promise<number> {
  let repaired = 0;
  const rosterMemberIds = new Set(
    team.members.filter((m): m is { ref: Extract<PartnerRef, { kind: 'member' }>; joinedAt: string } => m.ref.kind === 'member').map((m) => m.ref.memberId),
  );
  const bySession = new Map<string, Entry[]>();
  for (const e of allEntries) {
    const bucket = bySession.get(e.sessionId) ?? [];
    bucket.push(e);
    bySession.set(e.sessionId, bucket);
  }

  for (const session of futureSessions) {
    const sessionEntries = (bySession.get(session.id) ?? []).filter((e) => !e.teamSessionOnly);
    const byMember = new Map(sessionEntries.map((e) => [e.memberId, e]));

    for (const memberId of rosterMemberIds) {
      if (byMember.has(memberId)) continue; // has *a* doc (confirmed or cancelled) — not "missing"
      const now = new Date().toISOString();
      const doc: Entry = {
        id: entryId(session.id, memberId),
        sessionId: session.id,
        date: session.date,
        weekday: session.weekday,
        seriesId: session.seriesId,
        memberId,
        status: 'confirmed',
        partner: null,
        pairingId: null,
        teamId: team.id,
        teamSessionOnly: false,
        substitute: null,
        partnerSubstitute: null,
        isSubstituteFor: null,
        createdBy: actorMemberId,
        createdAt: now,
        updatedAt: now,
      };
      await db.doc(paths.entry(doc.id)).set(doc);
      await audit({ actorMemberId, action: 'pairing_repair', entityRef: paths.entry(doc.id), before: null, after: doc });
      repaired += 1;
    }

    for (const e of sessionEntries) {
      if (e.status === 'cancelled') continue;
      if (rosterMemberIds.has(e.memberId)) continue;
      const outcome = await repairEntryDoc(e.id, { status: 'cancelled' }, actorMemberId);
      if (outcome) repaired += 1;
    }
  }

  return repaired;
}

export interface RunPairingSweepOptions {
  repair?: boolean;
  /** `'system'` for the scheduled job; the admin's uid for the callable. */
  actorMemberId?: string;
}

/** Plain core (see module doc comment) — call this directly from tests. */
export async function runPairingSweep(opts: RunPairingSweepOptions = {}): Promise<RunPairingSweepResult> {
  const repair = !!opts.repair;
  const actorMemberId = opts.actorMemberId ?? 'system';
  const today = todayNZ();

  const violations: IntegrityViolation[] = [];
  let repaired = 0;

  // ---- pairing sessions ----
  const entriesSnap = await db.collection(paths.entries()).where('date', '>=', today).get();
  const bySession = new Map<string, Entry[]>();
  for (const doc of entriesSnap.docs) {
    const entry = doc.data() as Entry;
    const bucket = bySession.get(entry.sessionId) ?? [];
    bucket.push(entry);
    bySession.set(entry.sessionId, bucket);
  }

  for (const [sessionId, entries] of bySession) {
    const issues = validatePairingGroup(entries);
    if (issues.length === 0) continue;
    // `id` here is the sessionId, not a pairingId: `validatePairingGroup` must
    // run over the *whole* session to correctly catch a duplicate-entry (I1)
    // violation — splitting the session up by pairingId first would hide
    // exactly that class of bug (two entries for one member under different
    // pairingIds would end up in two different buckets, each looking fine).
    violations.push({ kind: 'pairing', id: sessionId, issues });
    if (repair) repaired += await repairSessionEntries(entries, actorMemberId);
  }

  // ---- teams ----
  let checkedTeams = 0;
  const teamsSnap = await db.collection(paths.teams()).where('status', 'in', ['forming', 'active']).get();
  for (const doc of teamsSnap.docs) {
    const team = doc.data() as Team;
    const { series, futureSessions } = await loadFutureTeamContext(team, today);
    if (!series || futureSessions.length === 0) continue; // scope: non-disbanded teams *with future sessions*
    checkedTeams += 1;

    const allEntries = await loadAllTeamEntries(team.id);
    const issues = validateTeamGroup(team, series, allEntries);
    if (issues.length === 0) continue;
    violations.push({ kind: 'team', id: team.id, issues });
    if (repair) repaired += await repairTeam(team, futureSessions, allEntries, actorMemberId);
  }

  const report: RunPairingSweepResult = {
    checkedSessions: bySession.size,
    checkedTeams,
    violations,
    repaired,
  };

  const runId = randomUUID();
  const runDoc: IntegrityRun = {
    id: runId,
    at: new Date().toISOString(),
    repair,
    checkedSessions: report.checkedSessions,
    checkedTeams: report.checkedTeams,
    violations: report.violations,
    repaired: report.repaired,
  };
  await db.doc(paths.integrityRun(runId)).set(runDoc);

  logger.info('pairing_sweep_done', {
    checkedSessions: report.checkedSessions,
    checkedTeams: report.checkedTeams,
    violations: report.violations.length,
    repaired: report.repaired,
    repairEnabled: repair,
  });

  return report;
}

/** Scheduled job — 03:00 Pacific/Auckland daily (plan §9.2). */
export const verifyPairingConsistency = onSchedule(
  { schedule: '0 3 * * *', timeZone: NZ_TIME_ZONE, region: REGION },
  async () => {
    const repair = process.env.PAIRING_SWEEP_REPAIR === 'true';
    await runPairingSweep({ repair, actorMemberId: 'system' });
  },
);

/** Admin callable — deployed as `runPairingSweep` (aliased in `index.ts`). */
export async function runPairingSweepCallableHandler(
  req: CallableRequest<RunPairingSweepInput>,
): Promise<RunPairingSweepResult> {
  const input = parseInput(RunPairingSweepInputSchema, req.data);
  const caller = await requireAdmin(req);
  return runPairingSweep({ repair: input.repair, actorMemberId: caller.uid });
}

export const runPairingSweepCallable = onCall(callableOptions, runPairingSweepCallableHandler);

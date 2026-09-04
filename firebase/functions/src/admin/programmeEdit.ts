/**
 * `updateSeries` / `updateSession` (plan §9.2, §16 Phase 6). Admin-only edits
 * to an already-imported programme (draft or published). Structural changes
 * that would orphan existing card entries are refused outright rather than
 * silently cascaded — only `updateSession`'s explicit `remove: true` and a
 * session date-move ever touch entries, and both are gated on there being
 * nothing active to lose (or, for `remove`, do so through the same cascade
 * `cancelEntry` uses).
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  UpdateSeriesInputSchema,
  UpdateSessionInputSchema,
  UpdateWeekdayInputSchema,
  paths,
  todayNZ,
  weekdayOfNZ,
  type Entry,
  type Invite,
  type Member,
  type Series,
  type Session,
  type UpdateSeriesInput,
  type UpdateSeriesResult,
  type UpdateSessionInput,
  type UpdateSessionResult,
  type UpdateWeekdayInput,
  type UpdateWeekdayResult,
  type WeekdayProgramme,
} from '@obc/shared';
import { db } from '../lib/admin.js';
import { audit } from '../lib/audit.js';
import { BatchWriter } from '../lib/batchWriter.js';
import { callableOptions } from '../lib/callable.js';
import { requireAdmin } from '../lib/context.js';
import { parseInput } from '../lib/parseInput.js';
import { cancelEntryInTx } from '../entries/lib.js';
import { createNotification } from '../notifications/create.js';
import { sessionIdForSeries, sessionIdForSingle } from './programmeIds.js'; // same directory (src/admin)

/* ---------------------------------- updateSeries -------------------------------- */

export async function updateSeriesHandler(req: CallableRequest<UpdateSeriesInput>): Promise<UpdateSeriesResult> {
  const input = parseInput(UpdateSeriesInputSchema, req.data);
  const caller = await requireAdmin(req);
  const patch = input.patch;

  if (Object.keys(patch).length === 0) {
    throw new HttpsError('invalid-argument', 'patch must set at least one field.');
  }
  if (patch.bestOf && patch.bestOf.n > patch.bestOf.m) {
    throw new HttpsError('invalid-argument', `bestOf.n (${patch.bestOf.n}) must be <= bestOf.m (${patch.bestOf.m}).`);
  }

  const seriesRef = db.doc(paths.seriesDoc(input.year, input.seriesId));
  const seriesSnap = await seriesRef.get();
  const series = seriesSnap.data() as Series | undefined;
  if (!series) throw new HttpsError('not-found', 'Series not found.');

  if (patch.format && patch.format !== series.format) {
    const entriesSnap = await db.collection(paths.entries()).where('seriesId', '==', input.seriesId).get();
    const hasActive = entriesSnap.docs.some((d) => (d.data() as Entry).status !== 'cancelled');
    if (hasActive) {
      throw new HttpsError(
        'failed-precondition',
        'Cannot change this series’ format while it has non-cancelled entries. Cancel them first.',
      );
    }
  }

  const before = series;
  const now = new Date().toISOString();
  const updated: Series = {
    ...series,
    ...patch,
    bestOf: patch.bestOf !== undefined ? patch.bestOf : series.bestOf,
    updatedAt: now,
  };

  const writer = new BatchWriter();
  writer.set(seriesRef, updated);

  const nameChanged = !!patch.name && patch.name !== series.name;
  const denormChanged =
    nameChanged || (patch.scoring && patch.scoring !== series.scoring) || (patch.format && patch.format !== series.format);

  if (denormChanged) {
    for (const sessionId of series.sessionIds) {
      const sessionRef = db.doc(paths.session(input.year, sessionId));
      const patchDoc: Partial<Session> & { updatedAt: string } = { updatedAt: now };
      if (nameChanged) {
        patchDoc.seriesName = updated.name;
        patchDoc.title = updated.name;
      }
      if (patch.scoring) patchDoc.scoring = updated.scoring;
      if (patch.format) patchDoc.format = updated.format;
      writer.update(sessionRef, patchDoc);
    }
  }
  await writer.flush();

  await audit({
    actorMemberId: caller.uid,
    action: 'programme_edit',
    entityRef: seriesRef.path,
    before: { name: before.name, scoring: before.scoring, format: before.format },
    after: { name: updated.name, scoring: updated.scoring, format: updated.format },
    detail: { year: input.year, seriesId: input.seriesId, patch },
  });

  // Notify members with a future non-cancelled entry in this series.
  const today = todayNZ();
  const futureEntriesSnap = await db
    .collection(paths.entries())
    .where('seriesId', '==', input.seriesId)
    .where('date', '>=', today)
    .get();
  const notifiedMemberIds = new Set<string>();
  for (const doc of futureEntriesSnap.docs) {
    const entry = doc.data() as Entry;
    if (entry.status === 'cancelled') continue;
    if (notifiedMemberIds.has(entry.memberId)) continue;
    notifiedMemberIds.add(entry.memberId);
    await createNotification(
      entry.memberId,
      'programme_changed',
      'A series you are entered in has changed',
      `The "${updated.name}" details changed.`,
      { seriesId: input.seriesId, year: String(input.year) },
    );
  }

  return { series: updated };
}

export const updateSeries = onCall(callableOptions, updateSeriesHandler);

/* --------------------------------- updateSession -------------------------------- */

export async function updateSessionHandler(req: CallableRequest<UpdateSessionInput>): Promise<UpdateSessionResult> {
  const input = parseInput(UpdateSessionInputSchema, req.data);
  const caller = await requireAdmin(req);
  const patch = input.patch;

  if (Object.keys(patch).length === 0) {
    throw new HttpsError('invalid-argument', 'patch must set at least one field.');
  }

  const sessionRef = db.doc(paths.session(input.year, input.sessionId));
  const sessionSnap = await sessionRef.get();
  const session = sessionSnap.data() as Session | undefined;
  if (!session) throw new HttpsError('not-found', 'Session not found.');

  let seriesRef: FirebaseFirestore.DocumentReference | undefined;
  let series: Series | undefined;
  if (session.seriesId) {
    seriesRef = db.doc(paths.seriesDoc(input.year, session.seriesId));
    const seriesSnap = await seriesRef.get();
    series = seriesSnap.data() as Series | undefined;
    if (!series) throw new HttpsError('not-found', 'Series not found.');
  }

  const nonCancelledEntries = async (): Promise<Entry[]> => {
    const snap = await db.collection(paths.entries()).where('sessionId', '==', input.sessionId).get();
    return snap.docs.map((d) => d.data() as Entry).filter((e) => e.status !== 'cancelled');
  };

  /* ------------------------------------ remove ----------------------------------- */
  if (patch.remove) {
    const activeEntries = await nonCancelledEntries();
    const memberNameCache = new Map<string, string>();
    let cancelledCount = 0;

    for (const entry of activeEntries) {
      const cascadeResult = await db.runTransaction(async (tx) => {
        const snap = await tx.get(db.doc(paths.entry(entry.id)));
        const fresh = snap.data() as Entry | undefined;
        if (!fresh || fresh.status === 'cancelled') return null;

        // A sibling entry processed earlier in this same loop may already
        // have cascaded this one into a solo, unpaired shape (e.g. the
        // partner freed to `looking_for_partner`) — `cancelEntryInTx`
        // assumes a still-occupied, still-existing session and would throw
        // on a bare solo entry. Since the whole session is being deleted
        // here, there is nothing left to "look for a partner" on: cancel it
        // directly instead of re-entering the pairing cascade.
        if (!fresh.teamId && fresh.partner?.kind !== 'visitor' && !fresh.pairingId) {
          const now = new Date().toISOString();
          const cancelled: Entry = { ...fresh, status: 'cancelled', updatedAt: now };
          tx.set(db.doc(paths.entry(fresh.id)), cancelled);
          return { ownEntry: cancelled, notify: [] };
        }

        let actorName = memberNameCache.get(fresh.memberId);
        if (!actorName) {
          const memberSnap = await tx.get(db.doc(paths.member(fresh.memberId)));
          const member = memberSnap.data() as { firstName?: string; lastName?: string } | undefined;
          actorName = member ? `${member.firstName ?? ''} ${member.lastName ?? ''}`.trim() : 'A member';
          memberNameCache.set(fresh.memberId, actorName);
        }
        return cancelEntryInTx(tx, fresh, { actorMemberId: fresh.memberId, actorName });
      });
      if (!cascadeResult) continue;
      cancelledCount += 1;
      for (const n of cascadeResult.notify) {
        await createNotification(n.memberId, n.type, n.title, n.body, n.data);
      }
      await createNotification(
        cascadeResult.ownEntry.memberId,
        'programme_changed',
        'A session was removed',
        `The ${session.title} session on ${session.date} was removed from the programme.`,
        { sessionId: session.id, year: String(input.year) },
      );
    }

    // Expire any pending invite referencing this session.
    const invitesSnap = await db
      .collection(paths.invites())
      .where('sessionIds', 'array-contains', input.sessionId)
      .where('status', '==', 'pending')
      .get();
    const writer = new BatchWriter();
    const now = new Date().toISOString();
    for (const doc of invitesSnap.docs) {
      const invite = doc.data() as Invite;
      writer.update(doc.ref, { status: 'expired', updatedAt: now });
      await createNotification(
        invite.fromMemberId,
        'invite_expired',
        'Your invite expired',
        'A session on your invite was removed from the programme.',
        { inviteId: invite.id },
      );
    }
    writer.delete(sessionRef);
    if (series && seriesRef) {
      const updatedSeries: Series = {
        ...series,
        sessionIds: series.sessionIds.filter((id) => id !== input.sessionId),
        updatedAt: now,
      };
      writer.set(seriesRef, updatedSeries);
    }
    await writer.flush();

    await audit({
      actorMemberId: caller.uid,
      action: 'programme_edit',
      entityRef: sessionRef.path,
      before: { date: session.date, title: session.title },
      after: null,
      detail: { year: input.year, sessionId: input.sessionId, removed: true, cancelledEntries: cancelledCount },
    });

    return { session: null, removed: true };
  }

  /* ---------------------------------- date move ----------------------------------- */
  if (patch.date && patch.date !== session.date) {
    const actualWeekday = weekdayOfNZ(patch.date);
    if (actualWeekday !== session.weekday) {
      throw new HttpsError(
        'invalid-argument',
        `${patch.date} is a ${actualWeekday}, not a ${session.weekday} as this session requires.`,
      );
    }

    const active = await nonCancelledEntries();
    if (active.length > 0) {
      throw new HttpsError('failed-precondition', 'Cancel entries first before moving this session’s date.');
    }

    const collisionSnap = await db.collection(paths.sessions(input.year)).where('date', '==', patch.date).get();
    if (collisionSnap.docs.some((d) => d.id !== session.id)) {
      throw new HttpsError('failed-precondition', `${patch.date} already has a session scheduled.`);
    }

    const newId = session.seriesId
      ? sessionIdForSeries(session.seriesId, patch.date)
      : sessionIdForSingle(input.year, patch.date, session.weekday);

    const now = new Date().toISOString();
    const newSession: Session = {
      ...session,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.partnerRequired !== undefined ? { partnerRequired: patch.partnerRequired } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      id: newId,
      date: patch.date,
      updatedAt: now,
    };

    const writer = new BatchWriter();
    writer.delete(sessionRef);
    writer.set(db.doc(paths.session(input.year, newId)), newSession);
    if (series && seriesRef) {
      const updatedSeries: Series = {
        ...series,
        sessionIds: [...series.sessionIds.filter((id) => id !== input.sessionId), newId].sort(),
        updatedAt: now,
      };
      writer.set(seriesRef, updatedSeries);
    }
    await writer.flush();

    await audit({
      actorMemberId: caller.uid,
      action: 'programme_edit',
      entityRef: paths.session(input.year, newId),
      before: { date: session.date },
      after: { date: newSession.date },
      detail: { year: input.year, oldSessionId: input.sessionId, newSessionId: newId },
    });

    return { session: newSession, removed: false };
  }

  /* -------------------------------- plain field patch ------------------------------ */
  const now = new Date().toISOString();
  const updatedSession: Session = {
    ...session,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.partnerRequired !== undefined ? { partnerRequired: patch.partnerRequired } : {}),
    ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
    updatedAt: now,
  };
  await sessionRef.set(updatedSession);

  await audit({
    actorMemberId: caller.uid,
    action: 'programme_edit',
    entityRef: sessionRef.path,
    before: { title: session.title, partnerRequired: session.partnerRequired, kind: session.kind },
    after: { title: updatedSession.title, partnerRequired: updatedSession.partnerRequired, kind: updatedSession.kind },
    detail: { year: input.year, sessionId: input.sessionId },
  });

  const activeEntries = await nonCancelledEntries();
  const notified = new Set<string>();
  for (const entry of activeEntries) {
    if (notified.has(entry.memberId)) continue;
    notified.add(entry.memberId);
    await createNotification(
      entry.memberId,
      'programme_changed',
      'A session you are entered in has changed',
      `Details for the ${updatedSession.title} session on ${updatedSession.date} were updated.`,
      { sessionId: session.id, year: String(input.year) },
    );
  }

  return { session: updatedSession, removed: false };
}

export const updateSession = onCall(callableOptions, updateSessionHandler);

/* --------------------------------- updateWeekday --------------------------------- */

/**
 * Admin-only partial edit to a weekday programme doc (`programmes/{year}/weekdays/{weekday}`,
 * plan §5.4, §9.2; backlog gap closed 2026-09-05). Until now the weekday's
 * label, times, partner steward and notes were only settable via the CSV
 * import's `stewardEmail` column, so a mid-year steward handover ("Joan
 * handed Mondays to Bill") required a full programme re-import. This is the
 * single point of change for those fields instead — same editing-a-published-
 * programme allowance as `updateSeries`/`updateSession`.
 *
 * `startTime` feeds `sessionCutoff` (plan §6): changing it changes when every
 * session on this weekday locks for entries, from the next read onward. No
 * cascade is needed — sessions and entries are untouched, since the lock
 * instant is computed from `startTime` at read time rather than stored.
 */
export async function updateWeekdayHandler(req: CallableRequest<UpdateWeekdayInput>): Promise<UpdateWeekdayResult> {
  const input = parseInput(UpdateWeekdayInputSchema, req.data);
  const caller = await requireAdmin(req);
  const patch = input.patch;

  if (Object.keys(patch).length === 0) {
    throw new HttpsError('invalid-argument', 'patch must set at least one field.');
  }

  const programmeRef = db.doc(paths.programme(input.year));
  const weekdayRef = db.doc(paths.weekday(input.year, input.weekday));

  const result = await db.runTransaction(async (tx) => {
    const [programmeSnap, weekdaySnap] = await Promise.all([tx.get(programmeRef), tx.get(weekdayRef)]);
    if (!programmeSnap.exists) throw new HttpsError('not-found', 'Programme not found.');
    const weekday = weekdaySnap.data() as WeekdayProgramme | undefined;
    if (!weekday) throw new HttpsError('not-found', 'Weekday not found.');

    if (patch.partnerStewardMemberId) {
      const stewardSnap = await tx.get(db.doc(paths.member(patch.partnerStewardMemberId)));
      const steward = stewardSnap.data() as Member | undefined;
      if (!steward || !steward.active) {
        throw new HttpsError('failed-precondition', 'That member is not available as a partner steward.');
      }
    }

    const now = new Date().toISOString();
    const updated: WeekdayProgramme = { ...weekday, updatedAt: now };
    if (patch.label !== undefined) updated.label = patch.label;
    if (patch.startTime !== undefined) updated.startTime = patch.startTime;
    if (patch.seatedByTime !== undefined) updated.seatedByTime = patch.seatedByTime;
    if (patch.partnerStewardMemberId !== undefined) {
      if (patch.partnerStewardMemberId === null) {
        delete updated.partnerStewardMemberId;
      } else {
        updated.partnerStewardMemberId = patch.partnerStewardMemberId;
      }
    }
    if (patch.notes !== undefined) {
      if (patch.notes === null) {
        delete updated.notes;
      } else {
        updated.notes = patch.notes;
      }
    }

    tx.set(weekdayRef, updated);
    return { before: weekday, after: updated };
  });

  await audit({
    actorMemberId: caller.uid,
    action: 'programme_edit',
    entityRef: weekdayRef.path,
    before: { label: result.before.label, startTime: result.before.startTime, seatedByTime: result.before.seatedByTime, partnerStewardMemberId: result.before.partnerStewardMemberId ?? null, notes: result.before.notes ?? null },
    after: { label: result.after.label, startTime: result.after.startTime, seatedByTime: result.after.seatedByTime, partnerStewardMemberId: result.after.partnerStewardMemberId ?? null, notes: result.after.notes ?? null },
    detail: { year: input.year, weekday: input.weekday, patch },
  });

  return { weekday: result.after };
}

export const updateWeekday = onCall(callableOptions, updateWeekdayHandler);

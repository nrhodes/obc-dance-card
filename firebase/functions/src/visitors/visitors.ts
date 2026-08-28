/**
 * `createVisitor`, `updateVisitor`, `deleteVisitor` (plan §9.2, §12). Visitors
 * are owned by the member who created them (`createdByMemberId`); only the
 * owner or an admin may update/delete one, and no callable ever returns a
 * visitor doc to anyone else — other members only ever see the denormalised
 * `displayName` on an entry's `PartnerRef` (plan §12.3).
 */
import { randomUUID } from 'node:crypto';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  CreateVisitorInputSchema,
  DeleteVisitorInputSchema,
  UpdateVisitorInputSchema,
  paths,
  todayNZ,
  type CreateVisitorInput,
  type CreateVisitorResult,
  type DeleteVisitorInput,
  type DeleteVisitorResult,
  type Entry,
  type Member,
  type UpdateVisitorInput,
  type UpdateVisitorResult,
  type Visitor,
} from '@obc/shared';
import { db } from '../lib/admin.js';
import { audit } from '../lib/audit.js';
import { callableOptions } from '../lib/callable.js';
import { BatchWriter } from '../lib/batchWriter.js';
import { requireMember, resolveActingMember } from '../lib/context.js';
import { parseInput } from '../lib/parseInput.js';
import { createNotification } from '../notifications/create.js';

/** Plan §12.6 / §8.1 "Email → Spam via visitor emails": max 20 visitors per member per programme year. */
const MAX_VISITORS_PER_MEMBER_PER_YEAR = 20;

/** True while `ref` (on an entry's partner/substitute/partnerSubstitute field) points at `visitorId`. */
function refIsVisitor(ref: Entry['partner'], visitorId: string): boolean {
  return !!ref && ref.kind === 'visitor' && ref.visitorId === visitorId;
}

/** Every non-cancelled entry, from today onward, that references `visitorId` anywhere. */
async function futureEntriesReferencing(visitorId: string): Promise<Entry[]> {
  const today = todayNZ();
  const snap = await db.collection(paths.entries()).where('date', '>=', today).get();
  return snap.docs
    .map((d) => d.data() as Entry)
    .filter(
      (e) =>
        e.status !== 'cancelled' &&
        (refIsVisitor(e.partner, visitorId) || refIsVisitor(e.substitute, visitorId) || refIsVisitor(e.partnerSubstitute, visitorId)),
    );
}

/**
 * Plan §12.6: warn (never block) when a visitor's display name matches an
 * active member's full name, case-insensitively. Club-scale — there is no
 * index that would make this a targeted query, so it reads every active
 * member and compares in code (same trade-off `updateVisitor`'s rename sweep
 * makes below).
 */
async function activeMemberNameCollision(displayName: string): Promise<boolean> {
  const target = displayName.trim().toLowerCase();
  const snap = await db.collection(paths.members()).where('active', '==', true).get();
  return snap.docs.some((d) => {
    const m = d.data() as Member;
    return `${m.firstName} ${m.lastName}`.trim().toLowerCase() === target;
  });
}

/* -------------------------------- createVisitor ------------------------------- */

export async function createVisitorHandler(req: CallableRequest<CreateVisitorInput>): Promise<CreateVisitorResult> {
  const input = parseInput(CreateVisitorInputSchema, req.data);
  const caller = await requireMember(req);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);

  const courtesyEmails = input.email ? (input.courtesyEmails ?? false) : false;
  const warnings: string[] = [];
  if (await activeMemberNameCollision(input.displayName)) {
    warnings.push(
      `An active member is also named "${input.displayName}" — double check you meant to add a visitor, not invite a member.`,
    );
  }

  const yearStart = `${todayNZ().slice(0, 4)}-01-01T00:00:00.000Z`;

  const visitor = await db.runTransaction(async (tx) => {
    const countSnap = await tx.get(
      db
        .collection(paths.visitors())
        .where('createdByMemberId', '==', actor.memberId)
        .where('createdAt', '>=', yearStart),
    );
    if (countSnap.size >= MAX_VISITORS_PER_MEMBER_PER_YEAR) {
      throw new HttpsError(
        'resource-exhausted',
        `You have reached the limit of ${MAX_VISITORS_PER_MEMBER_PER_YEAR} visitors for this programme year.`,
      );
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const doc: Visitor = {
      id,
      displayName: input.displayName,
      email: input.email,
      phone: input.phone,
      createdByMemberId: actor.memberId,
      notes: input.notes,
      courtesyEmails,
      lastUsedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    tx.set(db.doc(paths.visitor(id)), doc);
    return doc;
  });

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'create_visitor_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: paths.visitor(visitor.id),
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin added a visitor for you',
      `An admin added "${visitor.displayName}" as a visitor on your behalf.`,
      { visitorId: visitor.id },
    );
  }

  return { visitor, warnings };
}

export const createVisitor = onCall(callableOptions, createVisitorHandler);

/* -------------------------------- updateVisitor ------------------------------- */

export async function updateVisitorHandler(req: CallableRequest<UpdateVisitorInput>): Promise<UpdateVisitorResult> {
  const input = parseInput(UpdateVisitorInputSchema, req.data);
  const caller = await requireMember(req);
  const ref = db.doc(paths.visitor(input.visitorId));

  const { updated, nameChanged } = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const visitor = snap.data() as Visitor | undefined;
    if (!visitor) throw new HttpsError('not-found', 'Visitor not found.');
    if (visitor.createdByMemberId !== caller.uid && !caller.isAdmin) {
      throw new HttpsError('permission-denied', 'You do not own this visitor.');
    }

    const email = input.email !== undefined ? input.email : visitor.email;
    const courtesyEmails = email ? (input.courtesyEmails ?? visitor.courtesyEmails) : false;
    const displayName = input.displayName ?? visitor.displayName;

    const next: Visitor = {
      ...visitor,
      displayName,
      email,
      phone: input.phone !== undefined ? input.phone : visitor.phone,
      notes: input.notes !== undefined ? input.notes : visitor.notes,
      courtesyEmails,
      updatedAt: new Date().toISOString(),
    };
    tx.set(ref, next);
    return { updated: next, nameChanged: displayName !== visitor.displayName };
  });

  if (nameChanged) {
    await renameVisitorOnFutureEntries(updated.id, updated.displayName);
  }

  return { visitor: updated };
}

export const updateVisitor = onCall(callableOptions, updateVisitorHandler);

/**
 * Rewrites the denormalised `displayName` (plan §5.5) on every non-cancelled
 * *future* entry that references this visitor as `partner`, `substitute`, or
 * `partnerSubstitute`. There is no index on visitor refs (`partner.visitorId`
 * etc. are inside a map, not a top-level field Firestore can query), so this
 * filters `entries where date >= todayNZ()` in code — acceptable at club
 * scale (plan's own words for this exact case).
 */
async function renameVisitorOnFutureEntries(visitorId: string, displayName: string): Promise<void> {
  const today = todayNZ();
  const snap = await db.collection(paths.entries()).where('date', '>=', today).get();
  const writer = new BatchWriter();
  const now = new Date().toISOString();
  let any = false;

  for (const doc of snap.docs) {
    const entry = doc.data() as Entry;
    if (entry.status === 'cancelled') continue;
    const patch: Partial<Entry> = {};
    if (refIsVisitor(entry.partner, visitorId) && entry.partner!.displayName !== displayName) {
      patch.partner = { ...entry.partner!, displayName } as Entry['partner'];
    }
    if (refIsVisitor(entry.substitute, visitorId) && entry.substitute!.displayName !== displayName) {
      patch.substitute = { ...entry.substitute!, displayName } as Entry['substitute'];
    }
    if (refIsVisitor(entry.partnerSubstitute, visitorId) && entry.partnerSubstitute!.displayName !== displayName) {
      patch.partnerSubstitute = { ...entry.partnerSubstitute!, displayName } as Entry['partnerSubstitute'];
    }
    if (Object.keys(patch).length > 0) {
      any = true;
      writer.update(doc.ref, { ...patch, updatedAt: now });
    }
  }

  if (any) await writer.flush();
}

/* -------------------------------- deleteVisitor ------------------------------- */

export async function deleteVisitorHandler(req: CallableRequest<DeleteVisitorInput>): Promise<DeleteVisitorResult> {
  const input = parseInput(DeleteVisitorInputSchema, req.data);
  const caller = await requireMember(req);
  const ref = db.doc(paths.visitor(input.visitorId));

  const snap = await ref.get();
  const visitor = snap.data() as Visitor | undefined;
  if (!visitor) throw new HttpsError('not-found', 'Visitor not found.');
  if (visitor.createdByMemberId !== caller.uid && !caller.isAdmin) {
    throw new HttpsError('permission-denied', 'You do not own this visitor.');
  }

  const future = await futureEntriesReferencing(input.visitorId);
  if (future.length > 0) {
    throw new HttpsError(
      'failed-precondition',
      'This visitor has upcoming, non-cancelled entries — cancel those first.',
    );
  }

  // Past entries keep their denormalised `displayName` (plan §5.5/§12.3) —
  // acceptable: it is history, and the visitor doc it once pointed at is
  // gone deliberately (plan §8.1 "Privacy law" — erasure on request).
  await ref.delete();
  return { ok: true };
}

export const deleteVisitor = onCall(callableOptions, deleteVisitorHandler);

/**
 * iCal subscription feed token management (plan §21 B1). Four member
 * callables that create/display/rotate/remove the per-member CSPRNG token
 * `firebase/functions/src/ical/feed.ts`'s unauthenticated HTTP endpoint uses
 * to authorise a calendar client. Every mutation writes both sides in one
 * transaction: the server-only, hash-keyed `icalTokens/{sha256hex(token)}`
 * lookup doc the feed actually reads, and the plaintext copy on
 * `memberPrivate` that lets the owner redisplay their subscription URL
 * (plan §21 B1's deliberate deviation from "store hashed only" — see
 * `shared/src/models.ts#MemberPrivate.icalToken`).
 */
import { createHash, randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  CreateIcalFeedInputSchema,
  GetIcalFeedInputSchema,
  RemoveIcalFeedInputSchema,
  RotateIcalFeedInputSchema,
  paths,
  type CreateIcalFeedInput,
  type CreateIcalFeedResult,
  type GetIcalFeedInput,
  type GetIcalFeedResult,
  type IcalToken,
  type MemberPrivate,
  type RemoveIcalFeedInput,
  type RemoveIcalFeedResult,
  type RotateIcalFeedInput,
  type RotateIcalFeedResult,
} from '@obc/shared';
import { db } from '../lib/admin.js';
import { audit } from '../lib/audit.js';
import { callableOptions } from '../lib/callable.js';
import { requireMember, resolveActingMember } from '../lib/context.js';
import { parseInput } from '../lib/parseInput.js';
import { createNotification } from '../notifications/create.js';

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** 32 CSPRNG bytes, base64url-encoded — 43 characters (plan §21 B1). */
function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

function webAppBaseUrl(): string {
  return (process.env.WEB_APP_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

/** `{ url, webcalUrl }` for a plaintext token — shared by every callable that returns one. */
export function icalFeedUrls(token: string): { url: string; webcalUrl: string } {
  const url = `${webAppBaseUrl()}/ical/${token}.ics`;
  return { url, webcalUrl: url.replace(/^https?:/, 'webcal:') };
}

/* ---------------------------------- getIcalFeed ---------------------------------- */

export async function getIcalFeedHandler(req: CallableRequest<GetIcalFeedInput>): Promise<GetIcalFeedResult> {
  const input = parseInput(GetIcalFeedInputSchema, req.data);
  const caller = await requireMember(req);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);

  const snap = await db.doc(paths.memberPrivate(actor.memberId)).get();
  const data = snap.data() as MemberPrivate | undefined;
  if (!data?.icalToken) {
    return { url: null };
  }

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'get_ical_feed_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: paths.memberPrivate(actor.memberId),
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin viewed your calendar link',
      'An admin looked up your calendar subscription link on your behalf.',
      {},
    );
  }

  const { url, webcalUrl } = icalFeedUrls(data.icalToken);
  return { url, webcalUrl, createdAt: data.icalTokenCreatedAt ?? data.createdAt };
}

export const getIcalFeed = onCall(callableOptions, getIcalFeedHandler);

/* -------------------------------- createIcalFeed --------------------------------- */

export async function createIcalFeedHandler(
  req: CallableRequest<CreateIcalFeedInput>,
): Promise<CreateIcalFeedResult> {
  const input = parseInput(CreateIcalFeedInputSchema, req.data);
  const caller = await requireMember(req);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);

  const token = generateToken();
  const hash = sha256Hex(token);
  const now = new Date().toISOString();
  const memberPrivateRef = db.doc(paths.memberPrivate(actor.memberId));

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(memberPrivateRef);
    const data = snap.data() as MemberPrivate | undefined;
    if (!data) {
      throw new HttpsError('not-found', 'Profile not found.');
    }
    if (data.icalToken) {
      throw new HttpsError('failed-precondition', 'A calendar link already exists — reset it instead.');
    }
    const tokenDoc: IcalToken = { id: hash, memberId: actor.memberId, createdAt: now };
    tx.set(db.doc(paths.icalToken(hash)), tokenDoc);
    tx.set(memberPrivateRef, { icalToken: token, icalTokenCreatedAt: now, updatedAt: now }, { merge: true });
  });

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'create_ical_feed_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: paths.memberPrivate(actor.memberId),
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin created a calendar link for you',
      'An admin created a calendar subscription link for your bridge schedule on your behalf.',
      {},
    );
  }
  await createNotification(
    actor.memberId,
    'security',
    'Calendar link created',
    'A calendar link for your bridge schedule was created.',
    {},
  );

  return icalFeedUrls(token);
}

export const createIcalFeed = onCall(callableOptions, createIcalFeedHandler);

/* -------------------------------- rotateIcalFeed --------------------------------- */

export async function rotateIcalFeedHandler(
  req: CallableRequest<RotateIcalFeedInput>,
): Promise<RotateIcalFeedResult> {
  const input = parseInput(RotateIcalFeedInputSchema, req.data);
  const caller = await requireMember(req);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);

  const newToken = generateToken();
  const newHash = sha256Hex(newToken);
  const now = new Date().toISOString();
  const memberPrivateRef = db.doc(paths.memberPrivate(actor.memberId));

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(memberPrivateRef);
    const data = snap.data() as MemberPrivate | undefined;
    if (!data?.icalToken) {
      throw new HttpsError('failed-precondition', 'No calendar link exists yet — create one first.');
    }
    const oldHash = sha256Hex(data.icalToken);
    tx.delete(db.doc(paths.icalToken(oldHash)));
    const tokenDoc: IcalToken = { id: newHash, memberId: actor.memberId, createdAt: now };
    tx.set(db.doc(paths.icalToken(newHash)), tokenDoc);
    tx.set(memberPrivateRef, { icalToken: newToken, icalTokenCreatedAt: now, updatedAt: now }, { merge: true });
  });

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'rotate_ical_feed_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: paths.memberPrivate(actor.memberId),
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin reset your calendar link',
      'An admin reset your calendar subscription link on your behalf. The old link no longer works.',
      {},
    );
  }
  await createNotification(
    actor.memberId,
    'security',
    'Calendar link reset',
    'Your calendar link was reset — re-subscribe with the new link.',
    {},
  );

  return icalFeedUrls(newToken);
}

export const rotateIcalFeed = onCall(callableOptions, rotateIcalFeedHandler);

/* -------------------------------- removeIcalFeed --------------------------------- */

export async function removeIcalFeedHandler(
  req: CallableRequest<RemoveIcalFeedInput>,
): Promise<RemoveIcalFeedResult> {
  const input = parseInput(RemoveIcalFeedInputSchema, req.data);
  const caller = await requireMember(req);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);

  const memberPrivateRef = db.doc(paths.memberPrivate(actor.memberId));
  const now = new Date().toISOString();

  const removed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(memberPrivateRef);
    const data = snap.data() as MemberPrivate | undefined;
    if (!data?.icalToken) return false;
    const hash = sha256Hex(data.icalToken);
    tx.delete(db.doc(paths.icalToken(hash)));
    tx.set(
      memberPrivateRef,
      { icalToken: FieldValue.delete(), icalTokenCreatedAt: FieldValue.delete(), updatedAt: now },
      { merge: true },
    );
    return true;
  });

  // Idempotent: removing an already-absent feed is not an error (mirrors
  // `unregisterDevice`'s tolerance for a device that's already gone).
  if (!removed) {
    return { ok: true };
  }

  if (actor.onBehalfBy) {
    await audit({
      actorMemberId: actor.onBehalfBy,
      action: 'remove_ical_feed_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: paths.memberPrivate(actor.memberId),
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin removed your calendar link',
      'An admin removed your calendar subscription link on your behalf.',
      {},
    );
  }
  await createNotification(
    actor.memberId,
    'security',
    'Calendar link removed',
    'Your calendar link for your bridge schedule was removed.',
    {},
  );

  return { ok: true };
}

export const removeIcalFeed = onCall(callableOptions, removeIcalFeedHandler);

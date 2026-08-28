/**
 * Member self-service (plan §9.2 `updateMyContact`, `updateMyPrefs`,
 * `registerDevice`, `unregisterDevice`). Every handler writes only the
 * caller's own docs — the acting member is always `req.auth.uid` here (no
 * on-behalf support for these; that's an admin-only concept elsewhere).
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  RegisterDeviceInputSchema,
  UnregisterDeviceInputSchema,
  UpdateMyContactInputSchema,
  UpdateMyPrefsInputSchema,
  paths,
  type MemberPrivate,
  type RegisterDeviceInput,
  type RegisteredDevice,
  type UnregisterDeviceInput,
  type UpdateMyContactInput,
  type UpdateMyPrefsInput,
} from '@obc/shared';
import { db } from '../lib/admin.js';
import { callableOptions } from '../lib/callable.js';
import { requireMember } from '../lib/context.js';

const MAX_DEVICES = 10;

export async function updateMyContactHandler(
  req: CallableRequest<UpdateMyContactInput>,
): Promise<{ ok: true }> {
  const input = UpdateMyContactInputSchema.parse(req.data);
  const caller = await requireMember(req);

  if (input.phone !== undefined) {
    await db
      .doc(paths.member(caller.uid))
      .set({ phone: input.phone, updatedAt: new Date().toISOString() }, { merge: true });
  }

  return { ok: true };
}

export const updateMyContact = onCall(callableOptions, updateMyContactHandler);

export async function updateMyPrefsHandler(
  req: CallableRequest<UpdateMyPrefsInput>,
): Promise<{ ok: true }> {
  const input = UpdateMyPrefsInputSchema.parse(req.data);
  const caller = await requireMember(req);

  await db
    .doc(paths.memberPrivate(caller.uid))
    .set({ notificationPrefs: input, updatedAt: new Date().toISOString() }, { merge: true });

  return { ok: true };
}

export const updateMyPrefs = onCall(callableOptions, updateMyPrefsHandler);

export async function registerDeviceHandler(
  req: CallableRequest<RegisterDeviceInput>,
): Promise<{ ok: true }> {
  const input = RegisterDeviceInputSchema.parse(req.data);
  const caller = await requireMember(req);
  const ref = db.doc(paths.memberPrivate(caller.uid));

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Profile not found.');
    }
    const data = snap.data() as MemberPrivate;
    const devices = data.devices ?? [];
    const now = new Date().toISOString();
    const newDevice: RegisteredDevice = {
      token: input.token,
      platform: input.platform,
      label: input.label,
      lastSeenAt: now,
    };

    const existingIndex = devices.findIndex((d) => d.token === input.token);
    let next: RegisteredDevice[];
    if (existingIndex >= 0) {
      next = [...devices];
      next[existingIndex] = newDevice;
    } else if (devices.length < MAX_DEVICES) {
      next = [...devices, newDevice];
    } else {
      // Cap at 10: evict the oldest by lastSeenAt, then add the new one.
      const oldestFirst = [...devices].sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt));
      next = [...oldestFirst.slice(1), newDevice];
    }

    tx.set(ref, { devices: next, updatedAt: now }, { merge: true });
  });

  return { ok: true };
}

export const registerDevice = onCall(callableOptions, registerDeviceHandler);

export async function unregisterDeviceHandler(
  req: CallableRequest<UnregisterDeviceInput>,
): Promise<{ ok: true }> {
  const input = UnregisterDeviceInputSchema.parse(req.data);
  const caller = await requireMember(req);
  const ref = db.doc(paths.memberPrivate(caller.uid));

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() as MemberPrivate;
    const devices = (data.devices ?? []).filter((d) => d.token !== input.token);
    tx.set(ref, { devices, updatedAt: new Date().toISOString() }, { merge: true });
  });

  return { ok: true };
}

export const unregisterDevice = onCall(callableOptions, unregisterDeviceHandler);

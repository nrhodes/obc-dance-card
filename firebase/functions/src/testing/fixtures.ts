/**
 * Shared setup helpers for emulator-backed tests (`src/**\/*.emu.test.ts`).
 * See `src/testing/README.md` for the testing conventions this supports.
 */
import type { CallableRequest } from 'firebase-functions/v2/https';
import { DEFAULT_NOTIFICATION_PREFS, paths, type MemberGrade, type MemberPrivate, type MemberRole } from '@obc/shared';
import { auth, db } from '../lib/admin.js';

export interface MakeMemberOptions {
  role?: MemberRole;
  active?: boolean;
  grade?: MemberGrade;
  phone?: string;
  firstName?: string;
  lastName?: string;
  hasPassword?: boolean;
}

/** Creates a real emulator Auth user plus matching `members`/`memberPrivate` docs. */
export async function makeMember(email: string, opts: MakeMemberOptions = {}): Promise<string> {
  const user = await auth.createUser({ email, emailVerified: true, disabled: opts.active === false });
  const now = new Date().toISOString();
  await db.doc(paths.member(user.uid)).set({
    id: user.uid,
    firstName: opts.firstName ?? 'Test',
    lastName: opts.lastName ?? 'Member',
    phone: opts.phone ?? '',
    grade: opts.grade ?? 'Open',
    role: opts.role ?? 'member',
    active: opts.active ?? true,
    createdAt: now,
    updatedAt: now,
  });
  const memberPrivate: MemberPrivate = {
    id: user.uid,
    emailLower: email.toLowerCase(),
    notificationPrefs: DEFAULT_NOTIFICATION_PREFS,
    devices: [],
    hasPassword: opts.hasPassword ?? false,
    createdAt: now,
    updatedAt: now,
  };
  await db.doc(paths.memberPrivate(user.uid)).set(memberPrivate);
  return user.uid;
}

/** A minimal fake `CallableRequest` for calling an exported `xxxHandler` directly. */
export function fakeCallableRequest<T>(data: T, opts: { uid?: string; ip?: string } = {}): CallableRequest<T> {
  return {
    data,
    auth: opts.uid ? { uid: opts.uid, token: {} as never } : undefined,
    rawRequest: { headers: {}, ip: opts.ip ?? '203.0.113.1' } as never,
  } as unknown as CallableRequest<T>;
}

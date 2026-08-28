/**
 * Per-row member provisioning (plan §8.2 "Provisioning (admin)"), factored
 * out of `importMembers` so the seed script (plan §16 Phase 1) can reuse the
 * exact same code path instead of duplicating it.
 *
 * Matching is by `emailLower` only — see the "email changed" limitation
 * noted in the implementer's report; this function deliberately does not try
 * to detect a renamed email as an update.
 */
import type { DocumentData, DocumentReference } from 'firebase-admin/firestore';
import {
  DEFAULT_NOTIFICATION_PREFS,
  paths,
  type Member,
  type MemberGrade,
  type MemberPrivate,
  type MemberRole,
} from '@obc/shared';
import { auth, db } from '../lib/admin.js';
import type { BatchWriter } from '../lib/batchWriter.js';

export interface MemberRow {
  firstName: string;
  lastName: string;
  emailLower: string;
  phone: string;
  grade: MemberGrade;
  /** Only used by the seed script; CSV rows never set this — new members always start as 'member'. */
  role?: MemberRole;
}

export interface ProvisionOptions {
  /** When true, only reads are performed — no Auth calls, no Firestore writes. */
  dryRun: boolean;
  /** When provided (and not a dry run), writes are queued here instead of sent immediately. */
  writer?: BatchWriter;
}

export interface ProvisionResult {
  outcome: 'added' | 'updated' | 'unchanged';
  /** Null only for a dry-run 'added' preview, where no uid has been minted. */
  memberId: string | null;
}

async function writeDoc(
  writer: BatchWriter | undefined,
  ref: DocumentReference,
  data: DocumentData,
  merge: boolean,
): Promise<void> {
  if (writer) {
    writer.set(ref, data, merge ? { merge: true } : undefined);
    return;
  }
  if (merge) {
    await ref.set(data, { merge: true });
  } else {
    await ref.set(data);
  }
}

export async function provisionMember(
  row: MemberRow,
  opts: ProvisionOptions = { dryRun: false },
): Promise<ProvisionResult> {
  const existingPrivate = await db
    .collection('memberPrivate')
    .where('emailLower', '==', row.emailLower)
    .limit(1)
    .get();

  if (!existingPrivate.empty) {
    const uid = existingPrivate.docs[0]!.id;
    const memberRef = db.doc(paths.member(uid));
    const memberSnap = await memberRef.get();
    const member = memberSnap.data() as Member | undefined;
    const wasInactive = !member || member.active !== true;
    const changed =
      !member ||
      member.firstName !== row.firstName ||
      member.lastName !== row.lastName ||
      member.phone !== row.phone ||
      member.grade !== row.grade ||
      wasInactive;

    if (!opts.dryRun) {
      const now = new Date().toISOString();
      await writeDoc(
        opts.writer,
        memberRef,
        { firstName: row.firstName, lastName: row.lastName, phone: row.phone, grade: row.grade, active: true, updatedAt: now },
        true,
      );
      if (wasInactive) {
        await auth.updateUser(uid, { disabled: false });
      }
    }

    return { outcome: changed ? 'updated' : 'unchanged', memberId: uid };
  }

  if (opts.dryRun) {
    return { outcome: 'added', memberId: null };
  }

  let uid: string;
  try {
    const existingAuthUser = await auth.getUserByEmail(row.emailLower);
    uid = existingAuthUser.uid;
  } catch {
    const created = await auth.createUser({ email: row.emailLower, emailVerified: true, disabled: false });
    uid = created.uid;
  }

  const now = new Date().toISOString();
  const member: Member = {
    id: uid,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    grade: row.grade,
    role: row.role ?? 'member',
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  const memberPrivate: MemberPrivate = {
    id: uid,
    emailLower: row.emailLower,
    notificationPrefs: DEFAULT_NOTIFICATION_PREFS,
    devices: [],
    hasPassword: false,
    createdAt: now,
    updatedAt: now,
  };

  await writeDoc(opts.writer, db.doc(paths.member(uid)), member, false);
  await writeDoc(opts.writer, db.doc(paths.memberPrivate(uid)), memberPrivate, false);

  return { outcome: 'added', memberId: uid };
}

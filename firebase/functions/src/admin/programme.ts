/**
 * `publishProgramme` (plan §9.2). Admin-only. Flips a draft programme to
 * `published` and broadcasts a notification to every active member — the
 * only fan-out in Phase 2; the Phase 5 trigger later handles push/email
 * delivery of whatever `notifications` docs already exist.
 *
 * The core is factored into `runPublishProgramme(input, actorMemberId)` —
 * mirrors `runProgrammeImport` — so the seed script can publish the seeded
 * programme via the exact same code path instead of faking a callable
 * request.
 *
 * `updateSeries` / `updateSession` (plan §9.2 row) belong in this file too,
 * once implemented — not part of Phase 2a.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { PublishProgrammeInputSchema, paths, type Member, type PublishProgrammeInput, type PublishProgrammeResult } from '@obc/shared';
import { db } from '../lib/admin.js';
import { audit } from '../lib/audit.js';
import { callableOptions } from '../lib/callable.js';
import { requireAdmin } from '../lib/context.js';
import { createNotification } from '../notifications/create.js';
import { parseInput } from '../lib/parseInput.js';

const NOTIFY_CHUNK_SIZE = 50;

export async function runPublishProgramme(
  input: PublishProgrammeInput,
  actorMemberId: string,
): Promise<PublishProgrammeResult> {
  const programmeRef = db.doc(paths.programme(input.year));
  const publishedAt = new Date().toISOString();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(programmeRef);
    const programme = snap.data() as { status?: string } | undefined;
    if (!programme) {
      throw new HttpsError('not-found', `No programme exists for ${input.year}.`);
    }
    if (programme.status !== 'draft') {
      throw new HttpsError('failed-precondition', `Programme ${input.year} is already published.`);
    }
    const sessionsSnap = await tx.get(db.collection(paths.sessions(input.year)).limit(1));
    if (sessionsSnap.empty) {
      throw new HttpsError('failed-precondition', `Programme ${input.year} has no sessions; import it before publishing.`);
    }
    tx.update(programmeRef, { status: 'published', publishedAt, updatedAt: publishedAt });
  });

  await audit({
    actorMemberId,
    action: 'programme_publish',
    entityRef: programmeRef.path,
    detail: { year: input.year },
  });

  const activeMembersSnap = await db.collection(paths.members()).where('active', '==', true).get();
  const activeUids = activeMembersSnap.docs.map((d) => (d.data() as Member).id);

  for (let i = 0; i < activeUids.length; i += NOTIFY_CHUNK_SIZE) {
    const chunk = activeUids.slice(i, i + NOTIFY_CHUNK_SIZE);
    await Promise.all(
      chunk.map((memberId) =>
        createNotification(
          memberId,
          'broadcast',
          `The ${input.year} programme is out`,
          `The ${input.year} Orewa Bridge Club programme has been published — take a look and start signing up.`,
          { year: String(input.year) },
        ),
      ),
    );
  }

  return { year: input.year, publishedAt };
}

export async function publishProgrammeHandler(
  req: CallableRequest<PublishProgrammeInput>,
): Promise<PublishProgrammeResult> {
  const input = parseInput(PublishProgrammeInputSchema, req.data);
  const caller = await requireAdmin(req);
  return runPublishProgramme(input, caller.uid);
}

export const publishProgramme = onCall(callableOptions, publishProgrammeHandler);

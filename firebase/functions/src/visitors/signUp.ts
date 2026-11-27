/**
 * `signUpWithVisitor` (plan §9.2, §12.2). Resolves target sessions the same
 * way `sendInvite` does (series scope → every not-yet-locked session), writes
 * one one-sided `confirmed`/visitor-partner entry per session (I3), and sends
 * an opt-in courtesy email (plan §12.4) when the visitor has one on file.
 */
import { randomUUID } from 'node:crypto';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  SignUpWithVisitorInputSchema,
  sessionCutoff,
  validatePairingGroup,
  type Entry,
  type Series,
  type SignUpWithVisitorInput,
  type SignUpWithVisitorResult,
  type Visitor,
} from '@obc/shared';
import { db } from '../lib/admin.js';
import { audit } from '../lib/audit.js';
import { callableOptions } from '../lib/callable.js';
import { logger } from '../lib/logger.js';
import { SMTP_SECRETS } from '../lib/secrets.js';
import { requireMember, resolveActingMember } from '../lib/context.js';
import { clubOf } from '../lib/clubs.js';
import { getEmailProvider } from '../email/provider.js';
import { visitorCourtesyEmail } from '../email/templates/visitorCourtesy.js';
import { parseInput } from '../lib/parseInput.js';
import { createNotification } from '../notifications/create.js';
import { assertForceAllowed, assertSessionOpen, entryId, isFree, loadSession, readEntry, type LoadedSession } from '../entries/lib.js';

const MAX_LISTED_CONFLICTS = 10;

export async function signUpWithVisitorHandler(
  req: CallableRequest<SignUpWithVisitorInput>,
): Promise<SignUpWithVisitorResult> {
  const input = parseInput(SignUpWithVisitorInputSchema, req.data);
  const cp = clubOf(input);
  const caller = await requireMember(req, cp);
  assertForceAllowed(caller, input.force);
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId);

  const visitorSnap = await db.doc(cp.visitor(input.visitorId)).get();
  const visitor = visitorSnap.data() as Visitor | undefined;
  if (!visitor) throw new HttpsError('not-found', 'Visitor not found.');
  if (visitor.createdByMemberId !== actor.memberId && !caller.isAdmin) {
    throw new HttpsError('permission-denied', 'You may only sign up with your own visitor.');
  }

  const result = await db.runTransaction(async (tx) => {
    let targetSessionIds: string[];
    let series: Series | null = null;

    if (input.scope === 'session') {
      targetSessionIds = [input.sessionId!];
    } else {
      const seriesSnap = await tx.get(db.doc(cp.seriesDoc(input.year, input.seriesId!)));
      series = (seriesSnap.data() as Series | undefined) ?? null;
      if (!series) throw new HttpsError('not-found', 'Series not found.');
      targetSessionIds = series.sessionIds;
    }

    const loaded: LoadedSession[] = [];
    for (const sid of targetSessionIds) {
      loaded.push(await loadSession(cp, tx, input.year, sid));
    }

    let target = loaded;
    if (input.scope === 'series') {
      // Series sign-ups silently drop sessions that have already locked, same
      // as `sendInvite` (plan design notes) — every other precondition below
      // still applies to whatever remains.
      target = loaded.filter((ls) => Date.now() < sessionCutoff(ls.session.date, ls.weekday.startTime).getTime());
      if (target.length === 0) {
        throw new HttpsError('failed-precondition', 'Every session in this series has already started.');
      }
    }

    for (const ls of target) {
      assertSessionOpen(ls.session, ls.weekday, ls.programme, { force: input.force });
    }

    const conflictDates: string[] = [];
    for (const ls of target) {
      const existing = await readEntry(cp, tx, ls.session.id, actor.memberId);
      if (!isFree(existing)) conflictDates.push(ls.session.date);
    }
    if (conflictDates.length > 0) {
      throw new HttpsError(
        'failed-precondition',
        `Already committed on: ${conflictDates.slice(0, MAX_LISTED_CONFLICTS).join(', ')}.`,
      );
    }

    const now = new Date().toISOString();
    const written: Entry[] = [];
    for (const ls of target) {
      const entry: Entry = {
        id: entryId(ls.session.id, actor.memberId),
        sessionId: ls.session.id,
        date: ls.session.date,
        weekday: ls.session.weekday,
        seriesId: ls.session.seriesId,
        memberId: actor.memberId,
        cohort: actor.member.cohort,
        status: 'confirmed',
        partner: { kind: 'visitor', visitorId: visitor.id, displayName: visitor.displayName },
        pairingId: randomUUID(),
        teamId: null,
        teamSessionOnly: false,
        substitute: null,
        partnerSubstitute: null,
        isSubstituteFor: null,
        createdBy: actor.memberId,
        onBehalfBy: actor.onBehalfBy,
        createdAt: now,
        updatedAt: now,
      };
      const issues = validatePairingGroup([entry]);
      if (issues.length > 0) {
        throw new HttpsError('internal', `Pairing invariant violated: ${issues.join('; ')}`);
      }
      tx.set(db.doc(cp.entry(entry.id)), entry);
      written.push(entry);
    }

    tx.set(db.doc(cp.visitor(visitor.id)), { lastUsedAt: now }, { merge: true });

    return { entries: written, seriesName: series?.name };
  });

  if (actor.onBehalfBy) {
    await audit(cp, {
      actorMemberId: actor.onBehalfBy,
      action: 'sign_up_with_visitor_on_behalf',
      targetMemberId: actor.memberId,
      entityRef: cp.visitor(visitor.id),
    });
    await createNotification(
      actor.memberId,
      'on_behalf_action',
      'An admin signed you up with a visitor',
      `An admin signed you up to play with ${visitor.displayName} on your behalf.`,
      { visitorId: visitor.id },
    );
  }

  if (visitor.courtesyEmails && visitor.email) {
    const sponsorName = `${actor.member.firstName} ${actor.member.lastName}`;
    const content = visitorCourtesyEmail({
      sponsorName,
      sponsorPhone: actor.member.phone || undefined,
      dates: result.entries.map((e) => e.date),
      seriesName: result.seriesName,
    });
    // The sign-up has already committed; a mail failure must never turn it
    // into an error for the member (security review 2026-11-17, T1).
    try {
      await getEmailProvider().send({ to: visitor.email, subject: content.subject, text: content.text, html: content.html });
    } catch {
      logger.warn('visitor_email_failed', { kind: 'courtesy' });
    }
  }

  return { entries: result.entries };
}

// Binds the SMTP secrets: this callable sends the visitor courtesy email
// itself (security review 2026-11-17, T1 — it was exported with the bare
// options, so the secret read threw after the transaction had committed).
export const signUpWithVisitor = onCall({ ...callableOptions, secrets: SMTP_SECRETS }, signUpWithVisitorHandler);

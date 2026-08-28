/**
 * §12.5 visitor promotion on member import — see `../visitors/promotion.ts`
 * for the fallback variant this implements (kept-vs-deleted, never a
 * fabricated mirror entry).
 */
import { describe, expect, it } from 'vitest';
import type { CreateVisitorInput, Entry, ImportMembersInput } from '@obc/shared';
import { paths } from '@obc/shared';
import { auth, db } from '../lib/admin.js';
import { fakeCallableRequest, makeMember, makeProgramme, notificationsFor, sessionInFuture } from '../testing/fixtures.js';
import { createVisitorHandler } from '../visitors/visitors.js';
import { signUpWithVisitorHandler } from '../visitors/signUp.js';
import { importMembersHandler } from './importMembers.js';

const HEADER = 'firstName,lastName,email,phone,grade';

function csv(rows: string[][]): string {
  return [HEADER, ...rows.map((r) => r.join(','))].join('\n');
}

async function adminReq(input: ImportMembersInput) {
  const adminUid = await makeMember(`promo-admin-${Date.now()}-${Math.random()}@example.org`, { role: 'admin' });
  return fakeCallableRequest<ImportMembersInput>(input, { uid: adminUid });
}

describe('importMembers — visitor promotion (§12.5)', () => {
  it('deletes the visitor and notifies the sponsor when it has no future entries', async () => {
    const sponsor = await makeMember('promo-sponsor-nofuture@example.org');
    const { visitor } = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>(
        { displayName: 'Promo Visitor NoFuture', email: 'promo-visitor-nofuture@example.org' },
        { uid: sponsor },
      ),
    );

    const email = 'promo-visitor-nofuture@example.org';
    await importMembersHandler(await adminReq({ csv: csv([['Promo', 'Visitor', email, '021 000 0000', 'Open']]) }));

    const newMember = await auth.getUserByEmail(email);
    expect(newMember).toBeTruthy();

    const visitorSnap = await db.doc(paths.visitor(visitor.id)).get();
    expect(visitorSnap.exists).toBe(false);

    const notes = await notificationsFor(sponsor, 'visitor_promoted');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.data.memberId).toBe(newMember.uid);

    const auditSnap = await db.collection(paths.auditLog()).where('action', '==', 'visitor_promoted').get();
    expect(auditSnap.docs.some((d) => d.data().targetMemberId === sponsor)).toBe(true);
  });

  it('keeps the visitor doc (marked promotedToMemberId) when a future entry still references it', async () => {
    const sponsor = await makeMember('promo-sponsor-future@example.org');
    const { visitor } = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>(
        { displayName: 'Promo Visitor Future', email: 'promo-visitor-future@example.org' },
        { uid: sponsor },
      ),
    );
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    await signUpWithVisitorHandler(
      fakeCallableRequest(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0]!, visitorId: visitor.id },
        { uid: sponsor },
      ),
    );

    const email = 'promo-visitor-future@example.org';
    await importMembersHandler(await adminReq({ csv: csv([['Promo', 'Visitor', email, '021 000 0000', 'Open']]) }));

    const newMember = await auth.getUserByEmail(email);

    const visitorSnap = await db.doc(paths.visitor(visitor.id)).get();
    expect(visitorSnap.exists).toBe(true);
    expect((visitorSnap.data() as { promotedToMemberId?: string }).promotedToMemberId).toBe(newMember.uid);

    // The entry itself is untouched — still a valid I3 visitor pairing.
    const entry = (await db.doc(paths.entry(`${prog.sessionIds[0]!}_${sponsor}`)).get()).data() as Entry;
    expect(entry.partner).toEqual({ kind: 'visitor', visitorId: visitor.id, displayName: visitor.displayName });

    expect(await notificationsFor(sponsor, 'visitor_promoted')).toHaveLength(1);
  });

  it('does not promote anything during a dry run', async () => {
    const sponsor = await makeMember('promo-sponsor-dryrun@example.org');
    const { visitor } = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>(
        { displayName: 'Promo Visitor DryRun', email: 'promo-visitor-dryrun@example.org' },
        { uid: sponsor },
      ),
    );

    const email = 'promo-visitor-dryrun@example.org';
    await importMembersHandler(await adminReq({ csv: csv([['Promo', 'Visitor', email, '021 000 0000', 'Open']]), dryRun: true }));

    const visitorSnap = await db.doc(paths.visitor(visitor.id)).get();
    expect(visitorSnap.exists).toBe(true);
    expect(await notificationsFor(sponsor, 'visitor_promoted')).toHaveLength(0);
  });
});

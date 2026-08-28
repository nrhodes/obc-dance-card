import { describe, expect, it } from 'vitest';
import type { CreateVisitorInput, DeleteVisitorInput, Entry, UpdateVisitorInput } from '@obc/shared';
import { paths } from '@obc/shared';
import { db } from '../../lib/admin.js';
import { fakeCallableRequest, makeMember, makeProgramme, sessionInFuture } from '../../testing/fixtures.js';
import { entryId } from '../../entries/lib.js';
import { createVisitorHandler, deleteVisitorHandler, updateVisitorHandler } from '../visitors.js';

describe('createVisitor', () => {
  it('creates a visitor owned by the caller', async () => {
    const a = await makeMember('visitor-create-a@example.org');
    const result = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>({ displayName: 'Jane Visitor', email: 'JANE@Example.ORG' }, { uid: a }),
    );

    expect(result.visitor.displayName).toBe('Jane Visitor');
    expect(result.visitor.createdByMemberId).toBe(a);
    expect(result.visitor.email).toBe('jane@example.org');
    expect(result.warnings).toEqual([]);
  });

  it('forces courtesyEmails false when no email is given', async () => {
    const a = await makeMember('visitor-create-noemail@example.org');
    const result = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>({ displayName: 'No Email Visitor', courtesyEmails: true }, { uid: a }),
    );
    expect(result.visitor.courtesyEmails).toBe(false);
  });

  it('rejects an invalid email with invalid-argument', async () => {
    const a = await makeMember('visitor-create-bademail@example.org');
    await expect(
      createVisitorHandler(
        fakeCallableRequest<CreateVisitorInput>({ displayName: 'Bad Email', email: 'not-an-email' }, { uid: a }),
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('warns (but still creates) on a display name collision with an active member', async () => {
    const a = await makeMember('visitor-collision-a@example.org', { firstName: 'Sam', lastName: 'Smith' });
    const result = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>({ displayName: 'sam smith' }, { uid: a }),
    );
    expect(result.warnings.length).toBe(1);
    expect(result.visitor.displayName).toBe('sam smith');
  });

  it('refuses a 21st visitor in the same programme year with resource-exhausted', async () => {
    const a = await makeMember('visitor-cap-a@example.org');
    for (let i = 0; i < 20; i++) {
      await createVisitorHandler(fakeCallableRequest<CreateVisitorInput>({ displayName: `Visitor ${i}` }, { uid: a }));
    }
    await expect(
      createVisitorHandler(fakeCallableRequest<CreateVisitorInput>({ displayName: 'One Too Many' }, { uid: a })),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
  }, 20_000);

  it('admin can create a visitor on behalf of a member', async () => {
    const admin = await makeMember('visitor-onbehalf-admin@example.org', { role: 'admin' });
    const member = await makeMember('visitor-onbehalf-member@example.org');
    const result = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>(
        { displayName: 'On Behalf Visitor', onBehalfOfMemberId: member },
        { uid: admin },
      ),
    );
    expect(result.visitor.createdByMemberId).toBe(member);

    const auditSnap = await db.collection(paths.auditLog()).where('action', '==', 'create_visitor_on_behalf').get();
    expect(auditSnap.docs.some((d) => d.data().actorMemberId === admin && d.data().targetMemberId === member)).toBe(true);
  });
});

describe('updateVisitor', () => {
  it('rewrites the denormalised displayName on future non-cancelled entries only', async () => {
    const a = await makeMember('visitor-rename-a@example.org');
    const { visitor } = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>({ displayName: 'Old Name' }, { uid: a }),
    );

    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    const now = new Date().toISOString();

    const futureEntry: Entry = {
      id: entryId(sessionId, a),
      sessionId,
      date: prog.year + '-01-12',
      weekday: 'monday',
      seriesId: prog.seriesId,
      memberId: a,
      status: 'confirmed',
      partner: { kind: 'visitor', visitorId: visitor.id, displayName: 'Old Name' },
      pairingId: 'p1',
      teamId: null,
      teamSessionOnly: false,
      substitute: null,
      partnerSubstitute: null,
      isSubstituteFor: null,
      createdBy: a,
      createdAt: now,
      updatedAt: now,
    };
    // Use the real future session date so the `date >= today` sweep finds it.
    futureEntry.date = sessionInFuture('monday');
    await db.doc(paths.entry(futureEntry.id)).set(futureEntry);

    const pastEntry: Entry = {
      ...futureEntry,
      id: entryId(`${sessionId}-past`, a),
      sessionId: `${sessionId}-past`,
      date: '2000-01-01',
    };
    await db.doc(paths.entry(pastEntry.id)).set(pastEntry);

    const cancelledEntry: Entry = {
      ...futureEntry,
      id: entryId(`${sessionId}-cancelled`, a),
      sessionId: `${sessionId}-cancelled`,
      status: 'cancelled',
    };
    await db.doc(paths.entry(cancelledEntry.id)).set(cancelledEntry);

    await updateVisitorHandler(
      fakeCallableRequest<UpdateVisitorInput>({ visitorId: visitor.id, displayName: 'New Name' }, { uid: a }),
    );

    const updatedFuture = (await db.doc(paths.entry(futureEntry.id)).get()).data() as Entry;
    expect(updatedFuture.partner?.displayName).toBe('New Name');

    const updatedPast = (await db.doc(paths.entry(pastEntry.id)).get()).data() as Entry;
    expect(updatedPast.partner?.displayName).toBe('Old Name');

    const updatedCancelled = (await db.doc(paths.entry(cancelledEntry.id)).get()).data() as Entry;
    expect(updatedCancelled.partner?.displayName).toBe('Old Name');
  });

  it('rejects a non-owner, non-admin update with permission-denied', async () => {
    const a = await makeMember('visitor-update-owner@example.org');
    const b = await makeMember('visitor-update-other@example.org');
    const { visitor } = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>({ displayName: 'Owned Visitor' }, { uid: a }),
    );

    await expect(
      updateVisitorHandler(
        fakeCallableRequest<UpdateVisitorInput>({ visitorId: visitor.id, displayName: 'Hijacked' }, { uid: b }),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('allows an admin to update someone else’s visitor', async () => {
    const a = await makeMember('visitor-update-admin-owner@example.org');
    const admin = await makeMember('visitor-update-admin@example.org', { role: 'admin' });
    const { visitor } = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>({ displayName: 'Admin Editable' }, { uid: a }),
    );

    const result = await updateVisitorHandler(
      fakeCallableRequest<UpdateVisitorInput>({ visitorId: visitor.id, phone: '021 555 5555' }, { uid: admin }),
    );
    expect(result.visitor.phone).toBe('021 555 5555');
  });
});

describe('deleteVisitor', () => {
  it('refuses to delete while a future non-cancelled entry references the visitor', async () => {
    const a = await makeMember('visitor-delete-blocked@example.org');
    const { visitor } = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>({ displayName: 'Blocked Delete' }, { uid: a }),
    );

    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    const now = new Date().toISOString();
    const entry: Entry = {
      id: entryId(sessionId, a),
      sessionId,
      date: sessionInFuture('monday'),
      weekday: 'monday',
      seriesId: prog.seriesId,
      memberId: a,
      status: 'confirmed',
      partner: { kind: 'visitor', visitorId: visitor.id, displayName: visitor.displayName },
      pairingId: 'p1',
      teamId: null,
      teamSessionOnly: false,
      substitute: null,
      partnerSubstitute: null,
      isSubstituteFor: null,
      createdBy: a,
      createdAt: now,
      updatedAt: now,
    };
    await db.doc(paths.entry(entry.id)).set(entry);

    await expect(
      deleteVisitorHandler(fakeCallableRequest<DeleteVisitorInput>({ visitorId: visitor.id }, { uid: a })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    await db.doc(entry.id ? paths.entry(entry.id) : '').set({ ...entry, status: 'cancelled' }, { merge: true });
    const result = await deleteVisitorHandler(fakeCallableRequest<DeleteVisitorInput>({ visitorId: visitor.id }, { uid: a }));
    expect(result.ok).toBe(true);

    const gone = await db.doc(paths.visitor(visitor.id)).get();
    expect(gone.exists).toBe(false);
  });

  it('rejects a non-owner, non-admin delete with permission-denied', async () => {
    const a = await makeMember('visitor-del-owner@example.org');
    const b = await makeMember('visitor-del-other@example.org');
    const { visitor } = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>({ displayName: 'Not Yours' }, { uid: a }),
    );

    await expect(
      deleteVisitorHandler(fakeCallableRequest<DeleteVisitorInput>({ visitorId: visitor.id }, { uid: b })),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

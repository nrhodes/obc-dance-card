import { describe, expect, it } from 'vitest';
import type { CreateVisitorInput, SignUpWithVisitorInput } from '@obc/shared';
import { paths } from '@obc/shared';
import { db } from '../../lib/admin.js';
import {
  assertSessionPairingValid,
  fakeCallableRequest,
  makeMember,
  makeProgramme,
  sessionInFuture,
  sessionInPast,
} from '../../testing/fixtures.js';
import { createVisitorHandler } from '../visitors.js';
import { signUpWithVisitorHandler } from '../signUp.js';

describe('signUpWithVisitor — session scope', () => {
  it('creates a one-sided confirmed entry for the member', async () => {
    const a = await makeMember('signup-session-a@example.org');
    const { visitor } = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>({ displayName: 'Vic Visitor' }, { uid: a }),
    );
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;

    const result = await signUpWithVisitorHandler(
      fakeCallableRequest<SignUpWithVisitorInput>(
        { scope: 'session', year: prog.year, sessionId, visitorId: visitor.id },
        { uid: a },
      ),
    );

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.status).toBe('confirmed');
    expect(result.entries[0]!.partner).toEqual({ kind: 'visitor', visitorId: visitor.id, displayName: 'Vic Visitor' });
    expect(result.entries[0]!.pairingId).toBeTruthy();

    await assertSessionPairingValid(sessionId);

    const updatedVisitor = (await db.doc(paths.visitor(visitor.id)).get()).data();
    expect(updatedVisitor!.lastUsedAt).not.toBe(visitor.lastUsedAt);
  });

  it('rejects using a visitor you do not own', async () => {
    const owner = await makeMember('signup-notowned-owner@example.org');
    const other = await makeMember('signup-notowned-other@example.org');
    const { visitor } = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>({ displayName: 'Owned Visitor' }, { uid: owner }),
    );
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    await expect(
      signUpWithVisitorHandler(
        fakeCallableRequest<SignUpWithVisitorInput>(
          { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0]!, visitorId: visitor.id },
          { uid: other },
        ),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects a Teams session with failed-precondition', async () => {
    const a = await makeMember('signup-teams-a@example.org');
    const { visitor } = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>({ displayName: 'Teams Visitor' }, { uid: a }),
    );
    const prog = await makeProgramme({ seriesFormat: 'Teams', dates: [sessionInFuture('monday')] });

    await expect(
      signUpWithVisitorHandler(
        fakeCallableRequest<SignUpWithVisitorInput>(
          { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0]!, visitorId: visitor.id },
          { uid: a },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects a locked session with failed-precondition', async () => {
    const a = await makeMember('signup-locked-a@example.org');
    const { visitor } = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>({ displayName: 'Locked Visitor' }, { uid: a }),
    );
    const prog = await makeProgramme({ dates: [sessionInPast('monday')] });

    await expect(
      signUpWithVisitorHandler(
        fakeCallableRequest<SignUpWithVisitorInput>(
          { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0]!, visitorId: visitor.id },
          { uid: a },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('leaves nothing written when a conflicting session exists elsewhere in the request', async () => {
    const a = await makeMember('signup-conflict-a@example.org');
    const { visitor } = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>({ displayName: 'Conflict Visitor' }, { uid: a }),
    );
    const prog = await makeProgramme({ dates: [sessionInFuture('monday', 3), sessionInFuture('monday', 4)] });
    const [s1, s2] = prog.sessionIds as [string, string];

    // Occupy the second session directly so the series sign-up conflicts.
    await signUpWithVisitorHandler(
      fakeCallableRequest<SignUpWithVisitorInput>({ scope: 'session', year: prog.year, sessionId: s2, visitorId: visitor.id }, { uid: a }),
    );

    await expect(
      signUpWithVisitorHandler(
        fakeCallableRequest<SignUpWithVisitorInput>(
          { scope: 'series', year: prog.year, seriesId: prog.seriesId, visitorId: visitor.id },
          { uid: a },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    // s1 must remain untouched by the failed series call (atomic — nothing written).
    const s1Entries = await db.collection(paths.entries()).where('sessionId', '==', s1).get();
    expect(s1Entries.empty).toBe(true);
  });
});

describe('signUpWithVisitor — series scope', () => {
  it('creates one entry per session, each with its own pairingId', async () => {
    const a = await makeMember('signup-series-a@example.org');
    const { visitor } = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>({ displayName: 'Series Visitor' }, { uid: a }),
    );
    const prog = await makeProgramme({ dates: [sessionInFuture('monday', 3), sessionInFuture('monday', 5)] });

    const result = await signUpWithVisitorHandler(
      fakeCallableRequest<SignUpWithVisitorInput>(
        { scope: 'series', year: prog.year, seriesId: prog.seriesId, visitorId: visitor.id },
        { uid: a },
      ),
    );

    expect(result.entries).toHaveLength(2);
    const pairingIds = new Set(result.entries.map((e) => e.pairingId));
    expect(pairingIds.size).toBe(2);
    for (const sid of prog.sessionIds) {
      await assertSessionPairingValid(sid);
    }
  });
});

describe('signUpWithVisitor — courtesy email', () => {
  it('sends a link-free courtesy email when the visitor opted in', async () => {
    const a = await makeMember('signup-courtesy-a@example.org', { firstName: 'Pat', lastName: 'Sponsor', phone: '021 000 0000' });
    const { visitor } = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>(
        { displayName: 'Courtesy Visitor', email: 'courtesy-visitor@example.org', courtesyEmails: true },
        { uid: a },
      ),
    );
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    await signUpWithVisitorHandler(
      fakeCallableRequest<SignUpWithVisitorInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0]!, visitorId: visitor.id },
        { uid: a },
      ),
    );

    const outboxSnap = await db.collection('emulatorOutbox').where('to', '==', 'courtesy-visitor@example.org').get();
    expect(outboxSnap.empty).toBe(false);
    const mail = outboxSnap.docs[0]!.data();
    expect(mail.text).not.toMatch(/http/i);
    expect(mail.text).toContain('Pat Sponsor');
  });

  it('does not send an email when courtesyEmails is off', async () => {
    const a = await makeMember('signup-nocourtesy-a@example.org');
    const { visitor } = await createVisitorHandler(
      fakeCallableRequest<CreateVisitorInput>({ displayName: 'No Courtesy', email: 'no-courtesy@example.org' }, { uid: a }),
    );
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });

    await signUpWithVisitorHandler(
      fakeCallableRequest<SignUpWithVisitorInput>(
        { scope: 'session', year: prog.year, sessionId: prog.sessionIds[0]!, visitorId: visitor.id },
        { uid: a },
      ),
    );

    const outboxSnap = await db.collection('emulatorOutbox').where('to', '==', 'no-courtesy@example.org').get();
    expect(outboxSnap.empty).toBe(true);
  });
});

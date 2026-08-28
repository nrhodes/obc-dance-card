import { describe, expect, it } from 'vitest';
import { paths, type MemberPrivate, type SetSoloStatusInput } from '@obc/shared';
import { db } from '../../lib/admin.js';
import { setSoloStatusHandler } from '../../entries/entries.js';
import { fakeCallableRequest, makeMember, makeProgramme, notificationsFor, sessionInFuture } from '../../testing/fixtures.js';

async function optIn(memberId: string): Promise<void> {
  const ref = db.doc(paths.memberPrivate(memberId));
  const mp = (await ref.get()).data() as MemberPrivate;
  await ref.set({ notificationPrefs: { ...mp.notificationPrefs, matchmakingAlerts: true } }, { merge: true });
}

describe('matchmaking alerts (setSoloStatus -> looking_for_partner)', () => {
  it('alerts an opted-in, free member; not a busy member; not an opted-out member; not the poster', async () => {
    const poster = await makeMember('mm-poster@example.org');
    const free = await makeMember('mm-free@example.org');
    const busy = await makeMember('mm-busy@example.org');
    const optedOut = await makeMember('mm-optedout@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;

    await optIn(free);
    await optIn(busy);
    // optedOut stays default (matchmakingAlerts: false).

    // `busy` occupies the session so they must not be alerted.
    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>({ year: prog.year, sessionId, status: 'available' }, { uid: busy }),
    );

    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>({ year: prog.year, sessionId, status: 'looking_for_partner' }, { uid: poster }),
    );

    expect(await notificationsFor(free, 'matchmaking_alert')).toHaveLength(1);
    expect(await notificationsFor(busy, 'matchmaking_alert')).toHaveLength(0);
    expect(await notificationsFor(optedOut, 'matchmaking_alert')).toHaveLength(0);
    expect(await notificationsFor(poster, 'matchmaking_alert')).toHaveLength(0);
  });

  it('does not alert anyone for an "available" post', async () => {
    const poster = await makeMember('mm-available-poster@example.org');
    const free = await makeMember('mm-available-free@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    await optIn(free);

    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>(
        { year: prog.year, sessionId: prog.sessionIds[0]!, status: 'available' },
        { uid: poster },
      ),
    );

    expect(await notificationsFor(free, 'matchmaking_alert')).toHaveLength(0);
  });

  it('does not duplicate a second post for the same session within 24h', async () => {
    const poster1 = await makeMember('mm-dedupe-poster1@example.org');
    const poster2 = await makeMember('mm-dedupe-poster2@example.org');
    const free = await makeMember('mm-dedupe-free@example.org');
    const prog = await makeProgramme({ dates: [sessionInFuture('monday')] });
    const sessionId = prog.sessionIds[0]!;
    await optIn(free);

    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>({ year: prog.year, sessionId, status: 'looking_for_partner' }, { uid: poster1 }),
    );
    expect(await notificationsFor(free, 'matchmaking_alert')).toHaveLength(1);

    // poster1 is now paired-adjacent (still lfp, still free from `free`'s
    // perspective on this same session) — cancel their listing and have a
    // second poster (a different free member) post again for the same
    // session within the 24h window.
    await db.doc(paths.entry(`${sessionId}_${poster1}`)).set({ status: 'cancelled' }, { merge: true });
    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>({ year: prog.year, sessionId, status: 'looking_for_partner' }, { uid: poster2 }),
    );

    // Still exactly one alert for `free` on this session — deduped.
    expect(await notificationsFor(free, 'matchmaking_alert')).toHaveLength(1);
  });

  it('does not alert for an Individual-format session', async () => {
    const poster = await makeMember('mm-individual-poster@example.org');
    const free = await makeMember('mm-individual-free@example.org');
    const prog = await makeProgramme({ seriesFormat: 'Individual', dates: [sessionInFuture('monday')] });
    await optIn(free);

    await setSoloStatusHandler(
      fakeCallableRequest<SetSoloStatusInput>(
        { year: prog.year, sessionId: prog.sessionIds[0]!, status: 'looking_for_partner' },
        { uid: poster },
      ),
    );

    expect(await notificationsFor(free, 'matchmaking_alert')).toHaveLength(0);
  });
});

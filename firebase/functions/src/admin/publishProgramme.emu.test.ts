import { beforeAll, describe, expect, it } from 'vitest';
import type { PublishProgrammeInput } from '@obc/shared';
import { paths } from '@obc/shared';
import { db } from '../lib/admin.js';
import { fakeCallableRequest, makeMember } from '../testing/fixtures.js';
import { publishProgrammeHandler } from './programme.js';

// ImportProgrammeInputSchema/PublishProgrammeInputSchema cap year at 2100;
// stay well inside that range while giving every test its own year.
let yearCounter = 2070;
function freshYear(): number {
  return yearCounter++;
}

// One shared admin caller (see importProgramme.emu.test.ts for why: avoid
// inflating the shared emulator's active-member count across test files).
let adminUid: string;
beforeAll(async () => {
  adminUid = await makeMember(`admin-pub-${Date.now()}-${Math.random()}@example.org`, { role: 'admin' });
});

async function adminReq(input: PublishProgrammeInput) {
  return fakeCallableRequest<PublishProgrammeInput>(input, { uid: adminUid });
}

async function makeDraftProgramme(year: number, opts: { withSession: boolean }): Promise<void> {
  await db.doc(paths.programme(year)).set({ id: String(year), year, status: 'draft', createdAt: 'now', updatedAt: 'now' });
  if (opts.withSession) {
    await db.doc(paths.session(year, `${year}-01-04-monday`)).set({
      id: `${year}-01-04-monday`,
      date: `${year}-01-04`,
      weekday: 'monday',
      seriesId: null,
      kind: 'holidayBridge',
      title: 'Holiday Bridge',
      partnerRequired: true,
      createdAt: 'now',
      updatedAt: 'now',
    });
  }
}

describe('publishProgramme', () => {
  it('publishes a draft with sessions and notifies every active member', async () => {
    const year = freshYear();
    await makeDraftProgramme(year, { withSession: true });
    const active1 = await makeMember(`pub-active1-${year}@example.org`, { active: true });
    const active2 = await makeMember(`pub-active2-${year}@example.org`, { active: true });
    const inactive = await makeMember(`pub-inactive-${year}@example.org`, { active: false });

    const result = await publishProgrammeHandler(await adminReq({ year }));
    expect(result.year).toBe(year);
    expect(result.publishedAt).toBeTruthy();

    const programmeSnap = await db.doc(paths.programme(year)).get();
    expect(programmeSnap.data()).toMatchObject({ status: 'published' });
    expect(programmeSnap.data()?.publishedAt).toBeTruthy();

    for (const uid of [active1, active2]) {
      const notifSnap = await db.collection('notifications').where('memberId', '==', uid).get();
      expect(notifSnap.docs.some((d) => d.data().type === 'broadcast')).toBe(true);
    }
    const inactiveNotifSnap = await db.collection('notifications').where('memberId', '==', inactive).get();
    expect(inactiveNotifSnap.empty).toBe(true);
  });

  it('is idempotent: publishing an already-published year fails with failed-precondition', async () => {
    const year = freshYear();
    await makeDraftProgramme(year, { withSession: true });
    await publishProgrammeHandler(await adminReq({ year }));

    await expect(publishProgrammeHandler(await adminReq({ year }))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('refuses to publish a programme with zero sessions', async () => {
    const year = freshYear();
    await makeDraftProgramme(year, { withSession: false });

    await expect(publishProgrammeHandler(await adminReq({ year }))).rejects.toMatchObject({
      code: 'failed-precondition',
    });

    const programmeSnap = await db.doc(paths.programme(year)).get();
    expect(programmeSnap.data()?.status).toBe('draft');
  });

  it('refuses to publish a year with no programme at all', async () => {
    const year = freshYear();
    await expect(publishProgrammeHandler(await adminReq({ year }))).rejects.toMatchObject({ code: 'not-found' });
  });
});

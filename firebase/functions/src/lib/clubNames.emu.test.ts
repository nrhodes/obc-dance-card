/**
 * Naming a club in what people read (plan §21 B14.8 stage 3): the name comes
 * from the club's own record, and something addressed to a person names their
 * club only when they have exactly one.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PRODUCT_NAME, clubPaths, paths, type Club, type Member, type UpdateClubInput } from '@obc/shared';
import { db } from './admin.js';
import { cp as orewa, fakeCallableRequest, makeMember, notificationsFor } from '../testing/fixtures.js';
import { brandNameFor, brandNameForClubs, clubContactEmail, clubName, clubRecord, setUserClubActive } from './clubs.js';
import { createClubHandler, updateClubHandler } from '../clubs/platform.js';
import { setPasswordHandler } from '../auth/password.js';

const run = Date.now();
const CLUB_ID = `names-${run}`;
const second = clubPaths(CLUB_ID);

let platformAdmin: string;
let oneClub: string;
let twoClubs: string;

const asPlatform = <T>(data: T) => fakeCallableRequest<T>(data as never, { uid: platformAdmin, club: false });

beforeAll(async () => {
  platformAdmin = await makeMember(`names-pa-${run}@example.org`);
  await db.doc(paths.platformAdmin(platformAdmin)).set({ id: platformAdmin, grantedAt: 'now', grantedBy: 'test' });
  await createClubHandler(asPlatform({ clubId: CLUB_ID, name: 'Kaipara Bridge Club', shortName: 'Kaipara' }));

  oneClub = await makeMember(`names-one-${run}@example.org`);
  twoClubs = await makeMember(`names-two-${run}@example.org`);
  const membership = (await db.doc(orewa.member(twoClubs)).get()).data() as Member;
  await db.doc(second.member(twoClubs)).set(membership);
  await setUserClubActive(twoClubs, CLUB_ID, true);
});

describe('a club’s name', () => {
  it('is read from the club record, by paths or by id', async () => {
    expect(await clubName(second)).toBe('Kaipara Bridge Club');
    expect(await clubName(CLUB_ID)).toBe('Kaipara Bridge Club');
    expect(await clubName(orewa)).toBe(((await db.doc(paths.club(orewa.clubId)).get()).data() as Club).name);
  });

  it('follows a rename', async () => {
    await updateClubHandler(asPlatform<UpdateClubInput>({ clubId: CLUB_ID, patch: { name: 'Kaipara Harbour Bridge Club' } }));
    expect(await clubName(second)).toBe('Kaipara Harbour Bridge Club');
  });

  it('is refused for a club that does not exist', async () => {
    await expect(clubRecord(`missing-${run}`)).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('what a person is told the sender is', () => {
  it('is their club for a one-club person and the product for anyone else', async () => {
    expect(await brandNameFor(oneClub)).toBe(await clubName(orewa));
    expect(await brandNameFor(twoClubs)).toBe(PRODUCT_NAME);
    expect(await brandNameFor(`nobody-${run}`)).toBe(PRODUCT_NAME);
    expect(await brandNameForClubs([CLUB_ID])).toBe('Kaipara Harbour Bridge Club');
    expect(await brandNameForClubs([`missing-${run}`])).toBe(PRODUCT_NAME);
  });

  it('names it in the password notice', async () => {
    await setPasswordHandler(
      fakeCallableRequest({ password: 'correct horse battery staple 9' } as never, { uid: twoClubs, club: false }),
    );
    const notes = (await notificationsFor(twoClubs)).filter((n) => n.title === 'Password set');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toContain(`your ${PRODUCT_NAME} account`);
    expect(notes[0]!.body).not.toContain('Orewa');
  });
});

describe('a club’s contact address', () => {
  it('is absent until set, then set and cleared through updateClub', async () => {
    expect(clubContactEmail(await clubRecord(second))).toBeUndefined();

    await updateClubHandler(asPlatform<UpdateClubInput>({ clubId: CLUB_ID, patch: { contactEmail: 'Office@Kaipara.Example' } }));
    expect(clubContactEmail(await clubRecord(second))).toBe('office@kaipara.example');

    await updateClubHandler(asPlatform<UpdateClubInput>({ clubId: CLUB_ID, patch: { contactEmail: null } }));
    const cleared = (await db.doc(paths.club(CLUB_ID)).get()).data() as Club;
    expect('contactEmail' in cleared).toBe(false);
    expect(clubContactEmail(await clubRecord(second))).toBeUndefined();
  });

  it('falls back to the original club’s old setting only for that club', async () => {
    const original = await clubRecord(orewa);
    expect(clubContactEmail({ ...original, contactEmail: undefined })).toMatch(/@/);
    expect(clubContactEmail({ ...original, id: CLUB_ID, contactEmail: undefined })).toBeUndefined();
  });
});

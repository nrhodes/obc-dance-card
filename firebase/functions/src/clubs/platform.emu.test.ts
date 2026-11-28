/**
 * Platform administration (plan §21 B14.3, stage 2): who may call it, what
 * each callable does, and that a platform admin gains nothing inside a club
 * they are not a member of.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  clubPaths,
  paths,
  type AddMemberInput,
  type Club,
  type CreateClubInput,
  type Member,
  type PlatformAuditEntry,
  type SetClubAdminInput,
  type UpdateClubInput,
} from '@obc/shared';
import { auth, db } from '../lib/admin.js';
import { cp as orewa, fakeCallableRequest, makeMember, notificationsFor } from '../testing/fixtures.js';
import { addMemberHandler } from '../admin/members.js';
import { createClubHandler, listClubsHandler, setClubAdminHandler, updateClubHandler } from './platform.js';

const run = Date.now();
const CLUB_ID = `platform-${run}`;
const club = clubPaths(CLUB_ID);

let platformAdmin: string;
let ordinaryAdmin: string;

/** Platform callables are not club-scoped: never let the helper add the default club. */
/** `uid` defaults to the platform admin; pass `null` for a signed-out request. */
const asPlatform = <T>(data: T, uid: string | null = platformAdmin) =>
  fakeCallableRequest<T>(data as never, uid ? { uid, club: false } : { club: false });

async function platformAudit(action: string): Promise<PlatformAuditEntry[]> {
  const snap = await db.collection(paths.platformAuditLog()).where('action', '==', action).get();
  return snap.docs.map((d) => d.data() as PlatformAuditEntry).filter((e) => e.clubId === CLUB_ID);
}

beforeAll(async () => {
  platformAdmin = await makeMember(`pa-${run}@example.org`, { firstName: 'Petra', lastName: 'Platform' });
  await db.doc(paths.platformAdmin(platformAdmin)).set({ id: platformAdmin, grantedAt: 'now', grantedBy: 'test' });
  // An admin of the default club — but not a platform admin.
  ordinaryAdmin = await makeMember(`pa-clubadmin-${run}@example.org`, { role: 'admin' });
});

describe('who may administer the platform', () => {
  it('refuses the signed-out, ordinary members and club admins alike', async () => {
    const input: CreateClubInput = { clubId: `nope-${run}`, name: 'Nope', shortName: 'Nope' };
    await expect(createClubHandler(asPlatform(input, null))).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(createClubHandler(asPlatform(input, ordinaryAdmin))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(listClubsHandler(asPlatform({}, ordinaryAdmin))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(
      updateClubHandler(asPlatform<UpdateClubInput>({ clubId: orewa.clubId, patch: { name: 'Hijacked' } }, ordinaryAdmin)),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(
      setClubAdminHandler(
        asPlatform<SetClubAdminInput>({ clubId: orewa.clubId, email: `pa-${run}@example.org`, admin: true }, ordinaryAdmin),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await db.doc(paths.club(`nope-${run}`)).get()).exists).toBe(false);
  });
});

describe('createClub', () => {
  it('creates an active club and audits it', async () => {
    const result = await createClubHandler(asPlatform<CreateClubInput>({ clubId: CLUB_ID, name: 'Second Club', shortName: 'Second' }));
    expect(result.club).toMatchObject({ id: CLUB_ID, name: 'Second Club', shortName: 'Second', status: 'active' });
    expect((await db.doc(paths.club(CLUB_ID)).get()).data()).toEqual(result.club);
    expect((await platformAudit('club_created')).map((e) => e.actorUid)).toEqual([platformAdmin]);
  });

  it('refuses an id that is taken, and ids that are not slugs', async () => {
    await expect(
      createClubHandler(asPlatform<CreateClubInput>({ clubId: CLUB_ID, name: 'Again', shortName: 'Again' })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(((await db.doc(paths.club(CLUB_ID)).get()).data() as Club).name).toBe('Second Club');
    for (const clubId of ['a', 'Has Space', '../clubs', 'UPPER']) {
      await expect(
        createClubHandler(asPlatform<CreateClubInput>({ clubId, name: 'X', shortName: 'X' })),
      ).rejects.toMatchObject({ code: 'invalid-argument' });
    }
  });
});

describe('a platform admin has no rights inside a club', () => {
  it('cannot use that club’s admin callables without being its admin', async () => {
    await expect(
      addMemberHandler(
        fakeCallableRequest<AddMemberInput>(
          { clubId: CLUB_ID, firstName: 'A', lastName: 'B', email: `pa-x-${run}@example.org`, grade: 'Open' },
          { uid: platformAdmin },
        ),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('setClubAdmin', () => {
  const newEmail = `pa-newadmin-${run}@example.org`;

  it('creates a brand-new person as the club’s admin when given their name', async () => {
    await expect(
      setClubAdminHandler(asPlatform<SetClubAdminInput>({ clubId: CLUB_ID, email: newEmail, admin: true })),
    ).rejects.toMatchObject({ code: 'invalid-argument' });

    const result = await setClubAdminHandler(
      asPlatform<SetClubAdminInput>({ clubId: CLUB_ID, email: newEmail, admin: true, firstName: 'Nia', lastName: 'New' }),
    );
    expect(result.membershipCreated).toBe(true);
    expect(result.member).toMatchObject({ firstName: 'Nia', lastName: 'New', role: 'admin', active: true, email: newEmail });
    expect((await auth.getUserByEmail(newEmail)).uid).toBe(result.member.id);
    expect((await db.doc(paths.user(result.member.id)).get()).data()?.clubIds).toEqual([CLUB_ID]);
    expect((await platformAudit('club_admin_appointed')).some((e) => e.targetUid === result.member.id)).toBe(true);
    // The audit rows carry ids, never the person's name or email.
    expect(JSON.stringify(await platformAudit('club_admin_appointed'))).not.toContain('Nia');
    expect(JSON.stringify(await platformAudit('club_admin_appointed'))).not.toContain(newEmail);
  });

  it('attaches a member of another club, named from the membership they hold, and leaves that membership alone', async () => {
    const result = await setClubAdminHandler(
      asPlatform<SetClubAdminInput>({ clubId: CLUB_ID, email: `pa-${run}@example.org`, admin: true }),
    );
    expect(result.membershipCreated).toBe(true);
    expect(result.member).toMatchObject({ id: platformAdmin, firstName: 'Petra', lastName: 'Platform', role: 'admin', phone: '' });
    expect(((await db.doc(orewa.member(platformAdmin)).get()).data() as Member).role).toBe('member');
    expect(((await db.doc(paths.user(platformAdmin)).get()).data()?.clubIds as string[]).sort()).toEqual(
      [CLUB_ID, orewa.clubId].sort(),
    );
    expect((await notificationsFor(platformAdmin, 'security')).length).toBeGreaterThanOrEqual(1);

    // …and now that they ARE its admin, the club's admin callables work for them.
    const added = await addMemberHandler(
      fakeCallableRequest<AddMemberInput>(
        { clubId: CLUB_ID, firstName: 'Mo', lastName: 'Member', email: `pa-member-${run}@example.org`, grade: 'Open' },
        { uid: platformAdmin },
      ),
    );
    expect((await db.doc(club.member(added.member.id)).get()).exists).toBe(true);
  });

  it('promotes an existing member of the club, and is a no-op for an existing admin', async () => {
    const email = `pa-member-${run}@example.org`;
    const promoted = await setClubAdminHandler(asPlatform<SetClubAdminInput>({ clubId: CLUB_ID, email, admin: true }));
    expect(promoted).toMatchObject({ membershipCreated: false, member: { role: 'admin' } });
    const before = (await platformAudit('club_admin_appointed')).length;
    await setClubAdminHandler(asPlatform<SetClubAdminInput>({ clubId: CLUB_ID, email, admin: true }));
    expect((await platformAudit('club_admin_appointed')).length).toBe(before);
  });

  it('removes admin rights but keeps the membership, and never leaves a club with no admin', async () => {
    const removed = await setClubAdminHandler(
      asPlatform<SetClubAdminInput>({ clubId: CLUB_ID, email: `pa-member-${run}@example.org`, admin: false }),
    );
    expect(removed.member).toMatchObject({ role: 'member', active: true });
    await setClubAdminHandler(asPlatform<SetClubAdminInput>({ clubId: CLUB_ID, email: newEmail, admin: false }));

    // Only the platform admin is left as this club's admin.
    await expect(
      setClubAdminHandler(asPlatform<SetClubAdminInput>({ clubId: CLUB_ID, email: `pa-${run}@example.org`, admin: false })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(((await db.doc(club.member(platformAdmin)).get()).data() as Member).role).toBe('admin');
    expect((await platformAudit('club_admin_removed')).length).toBe(2);
  });

  it('refuses an unknown club, and removing someone who is not a member', async () => {
    await expect(
      setClubAdminHandler(asPlatform<SetClubAdminInput>({ clubId: `missing-${run}`, email: newEmail, admin: true })),
    ).rejects.toMatchObject({ code: 'not-found' });
    await expect(
      setClubAdminHandler(asPlatform<SetClubAdminInput>({ clubId: CLUB_ID, email: `stranger-${run}@example.org`, admin: false })),
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('listClubs', () => {
  it('lists each club with its active-member count and admins', async () => {
    const { clubs } = await listClubsHandler(asPlatform({}));
    const mine = clubs.find((c) => c.club.id === CLUB_ID)!;
    expect(mine.club.name).toBe('Second Club');
    expect(mine.activeMembers).toBe(3);
    expect(mine.admins.map((a) => a.name)).toEqual(['Petra Platform']);
    expect(clubs.some((c) => c.club.id === orewa.clubId)).toBe(true);
  });
});

describe('updateClub', () => {
  it('renames and recolours, auditing field names only', async () => {
    const result = await updateClubHandler(
      asPlatform<UpdateClubInput>({ clubId: CLUB_ID, patch: { name: 'Renamed Club', colour: '#336699' } }),
    );
    expect(result).toMatchObject({ changed: true, club: { name: 'Renamed Club', colour: '#336699', shortName: 'Second' } });
    expect((await platformAudit('club_updated'))[0]?.detail).toEqual({ fields: ['name', 'colour'] });

    const cleared = await updateClubHandler(asPlatform<UpdateClubInput>({ clubId: CLUB_ID, patch: { colour: null } }));
    expect(cleared.club.colour).toBeUndefined();

    const noop = await updateClubHandler(asPlatform<UpdateClubInput>({ clubId: CLUB_ID, patch: { name: 'Renamed Club' } }));
    expect(noop.changed).toBe(false);
  });

  it('suspends a club — its callables are then refused — and reactivates it', async () => {
    await updateClubHandler(asPlatform<UpdateClubInput>({ clubId: CLUB_ID, patch: { status: 'suspended' } }));
    expect((await platformAudit('club_suspended')).length).toBe(1);
    await expect(
      addMemberHandler(
        fakeCallableRequest<AddMemberInput>(
          { clubId: CLUB_ID, firstName: 'A', lastName: 'B', email: `pa-y-${run}@example.org`, grade: 'Open' },
          { uid: platformAdmin },
        ),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    await updateClubHandler(asPlatform<UpdateClubInput>({ clubId: CLUB_ID, patch: { status: 'active' } }));
    expect((await platformAudit('club_reactivated')).length).toBe(1);
  });

  it('refuses a suspension that would lock the caller out of every club', async () => {
    // A platform admin whose only membership is this club.
    const lone = await setClubAdminHandler(
      asPlatform<SetClubAdminInput>({
        clubId: CLUB_ID,
        email: `pa-lone-${run}@example.org`,
        admin: true,
        firstName: 'Lone',
        lastName: 'Admin',
      }),
    );
    await db.doc(paths.platformAdmin(lone.member.id)).set({ id: lone.member.id, grantedAt: 'now', grantedBy: 'test' });

    await expect(
      updateClubHandler(asPlatform<UpdateClubInput>({ clubId: CLUB_ID, patch: { status: 'suspended' } }, lone.member.id)),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(((await db.doc(paths.club(CLUB_ID)).get()).data() as Club).status).toBe('active');
  });

  it('refuses an unknown club', async () => {
    await expect(
      updateClubHandler(asPlatform<UpdateClubInput>({ clubId: `missing-${run}`, patch: { name: 'X' } })),
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});

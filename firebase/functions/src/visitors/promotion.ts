/**
 * Visitor promotion on member import (plan §12.5, §20 open item 1).
 *
 * Plan §12.5 as written asks for a full rewrite: on import, replace a
 * visitor's `partner` ref on every future entry with a member ref for the
 * newly-imported member, without creating a mirror entry on the new
 * member's card. That shape is deliberately rejected here: a `confirmed`
 * `kind: 'member'` `partner` with no mirrored entry on the other side is
 * exactly the shape `validatePairingGroup` (I2) exists to reject — the new
 * member never accepted anything, so fabricating half of a pairing for them
 * would either violate I2 or require carving out a special case in the one
 * validator every other pairing mutation trusts. §12.5 itself offers this as
 * an explicit fallback ("simpler alternative ... is acceptable if this
 * proves fiddly"), so this file takes it: the visitor pairing is left
 * exactly as it was (still a valid I3 shape), the sponsor is notified to
 * re-invite the new member, and the visitor doc is deleted only once it has
 * no future non-cancelled entries left to denormalise a name for —
 * otherwise it is kept (with `promotedToMemberId` set) purely so existing
 * entries keep rendering a name.
 */
import { paths, todayNZ, type Entry, type Visitor } from '@obc/shared';
import { db } from '../lib/admin.js';
import { audit } from '../lib/audit.js';
import { createNotification } from '../notifications/create.js';

function refIsVisitor(ref: Entry['partner'], visitorId: string): boolean {
  return !!ref && ref.kind === 'visitor' && ref.visitorId === visitorId;
}

/**
 * Called by `importMembers` right after a *new* member row is provisioned.
 * `actorMemberId` is the importing admin, for audit attribution — the new
 * member did nothing here; they were simply imported.
 */
export async function promoteVisitorsForNewMember(
  newMemberId: string,
  emailLower: string,
  actorMemberId: string,
): Promise<void> {
  const visitorsSnap = await db.collection(paths.visitors()).where('email', '==', emailLower).get();
  if (visitorsSnap.empty) return;

  const today = todayNZ();
  const futureEntriesSnap = await db.collection(paths.entries()).where('date', '>=', today).get();
  const futureEntries = futureEntriesSnap.docs.map((d) => d.data() as Entry);

  for (const visitorDoc of visitorsSnap.docs) {
    const visitor = visitorDoc.data() as Visitor;
    const hasFutureEntry = futureEntries.some(
      (e) =>
        e.status !== 'cancelled' &&
        (refIsVisitor(e.partner, visitor.id) || refIsVisitor(e.substitute, visitor.id) || refIsVisitor(e.partnerSubstitute, visitor.id)),
    );

    await createNotification(
      visitor.createdByMemberId,
      'visitor_promoted',
      `${visitor.displayName} is now a member`,
      `${visitor.displayName} has joined Orewa Bridge Club as a member — invite them so it appears on their card.`,
      { visitorId: visitor.id, memberId: newMemberId },
    );

    if (hasFutureEntry) {
      await db.doc(paths.visitor(visitor.id)).set({ promotedToMemberId: newMemberId }, { merge: true });
    } else {
      await db.doc(paths.visitor(visitor.id)).delete();
    }

    await audit({
      actorMemberId,
      action: 'visitor_promoted',
      targetMemberId: visitor.createdByMemberId,
      entityRef: paths.visitor(visitor.id),
      detail: { promotedMemberId: newMemberId, visitorKept: hasFutureEntry },
    });
  }
}

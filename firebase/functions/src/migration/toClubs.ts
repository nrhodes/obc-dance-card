/**
 * Stage 1b of plan §21 B14.8: copy the pre-club, top-level data into the
 * per-club layout.
 *
 *   members, visitors, teams, imports, entries,
 *   invites, auditLog, integrity            ->  clubs/{clubId}/<same name>
 *   programmes/{year} + weekdays|series|sessions
 *                                           ->  clubs/{clubId}/programmes/{year}/…
 *   memberPrivate/{uid}                     ->  userPrivate/{uid}
 *   (derived) users/{uid}.clubIds           <-  whether the member is active
 *   (created) clubs/{clubId}
 *
 * Documents are copied byte-for-byte; ids do not change. The old documents
 * are NEVER modified or deleted — rollback is "deploy the previous build",
 * which still reads them.
 *
 * Safe to run repeatedly, before and after the new build goes live. For each
 * document, comparing the old copy with the new one:
 *
 *   - new copy missing                     -> copy            ("created")
 *   - identical                            -> nothing         ("same")
 *   - differ, old written more recently    -> copy again      ("refreshed")
 *     (the old build changed it after the previous run)
 *   - differ, new written more recently    -> leave it alone  ("keptNewer")
 *     (the new build has since changed the new copy; that is the live data)
 *
 * So the cutover is: run, deploy, run again to catch anything the old build
 * wrote in between, then CLOSE the migration (`closeClubsMigration`).
 *
 * Closing matters. Once the new build is live it also DELETES documents
 * (a visitor, a purged invite): a later run would see "old exists, new
 * missing" and resurrect them. A closed migration refuses to copy again.
 *
 * A document deleted from the old layout between two runs is not detected —
 * the runbook's quiet window is what makes that negligible — and `verify`
 * reports any new-side document with no old counterpart so it can be looked
 * at.
 *
 * Pure with respect to its `db` argument: no globals, no Auth calls (uids do
 * not change, so Auth is untouched), so it can be exercised against the
 * emulator by `toClubs.emu.test.ts`.
 */
import { isDeepStrictEqual } from 'node:util';
import { FieldValue, type DocumentData, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { LEGACY_PATHS, clubPaths, paths, type Club, type ClubId } from '@obc/shared';

export interface CollectionReport {
  /** The pre-migration collection path. */
  from: string;
  /** Where its documents now live. */
  to: string;
  oldCount: number;
  created: number;
  refreshed: number;
  same: number;
  keptNewer: number;
  /** Present on the new side with no old counterpart (expected once the new build is live). */
  onlyInNew: number;
}

export interface MigrationReport {
  clubId: ClubId;
  execute: boolean;
  clubDocCreated: boolean;
  collections: CollectionReport[];
  /** `users/{uid}` docs written (or that would be). */
  usersWritten: number;
  /** Total documents written (or that would be), across everything. */
  totalWrites: number;
}

export interface MigrateOptions {
  clubId: ClubId;
  /** The `clubs/{clubId}` record to create if it does not exist. */
  club: Club;
  /** False (the default posture) reads and reports only. */
  execute: boolean;
}

const BATCH_LIMIT = 400;

class Writes {
  private batch: FirebaseFirestore.WriteBatch;
  private pending = 0;
  total = 0;

  constructor(
    private readonly db: Firestore,
    private readonly execute: boolean,
  ) {
    this.batch = db.batch();
  }

  async set(path: string, data: DocumentData, merge = false): Promise<void> {
    this.total += 1;
    if (!this.execute) return;
    if (merge) this.batch.set(this.db.doc(path), data, { merge: true });
    else this.batch.set(this.db.doc(path), data);
    this.pending += 1;
    if (this.pending >= BATCH_LIMIT) await this.flush();
  }

  async flush(): Promise<void> {
    if (this.pending === 0) return;
    await this.batch.commit();
    this.batch = this.db.batch();
    this.pending = 0;
  }
}

type Decision = 'created' | 'refreshed' | 'same' | 'keptNewer';

function decide(oldDoc: QueryDocumentSnapshot, newDoc: QueryDocumentSnapshot | undefined): Decision {
  if (!newDoc) return 'created';
  if (isDeepStrictEqual(oldDoc.data(), newDoc.data())) return 'same';
  return oldDoc.updateTime.toMillis() > newDoc.updateTime.toMillis() ? 'refreshed' : 'keptNewer';
}

/** Copies one collection's documents; `onCopied` runs for each document actually (re)copied. */
async function copyCollection(
  db: Firestore,
  writes: Writes,
  from: string,
  to: string,
  onCopied?: (doc: QueryDocumentSnapshot) => Promise<void>,
): Promise<CollectionReport> {
  const [oldSnap, newSnap] = await Promise.all([db.collection(from).get(), db.collection(to).get()]);
  const newById = new Map(newSnap.docs.map((d) => [d.id, d]));
  const report: CollectionReport = {
    from,
    to,
    oldCount: oldSnap.size,
    created: 0,
    refreshed: 0,
    same: 0,
    keptNewer: 0,
    onlyInNew: 0,
  };
  const oldIds = new Set<string>();
  for (const oldDoc of oldSnap.docs) {
    oldIds.add(oldDoc.id);
    const decision = decide(oldDoc, newById.get(oldDoc.id));
    report[decision] += 1;
    if (decision === 'created' || decision === 'refreshed') {
      await writes.set(`${to}/${oldDoc.id}`, oldDoc.data());
      if (onCopied) await onCopied(oldDoc);
    }
  }
  report.onlyInNew = newSnap.docs.filter((d) => !oldIds.has(d.id)).length;
  return report;
}

/** Every (old collection, new collection) pair, including each programme year's sub-collections. */
async function collectionPairs(db: Firestore, clubId: ClubId): Promise<Array<{ from: string; to: string }>> {
  const root = clubPaths(clubId);
  const pairs: Array<{ from: string; to: string }> = [];
  // `clubPaths` spells every club collection as `clubs/{clubId}/<name>`.
  const clubRoot = root.members().slice(0, -'members'.length);
  for (const name of LEGACY_PATHS.clubCollections) {
    pairs.push({ from: name, to: `${clubRoot}${name}` });
  }
  pairs.push({ from: LEGACY_PATHS.programmes, to: root.programmes() });
  const years = await db.collection(LEGACY_PATHS.programmes).listDocuments();
  for (const yearRef of years) {
    for (const sub of LEGACY_PATHS.programmeSubcollections) {
      pairs.push({ from: `${LEGACY_PATHS.programmes}/${yearRef.id}/${sub}`, to: `${root.programme(yearRef.id)}/${sub}` });
    }
  }
  return pairs;
}

/** The field on `clubs/{clubId}` that marks the migration finished. */
const CLOSED_FIELD = 'migratedFromLegacyAt';

export class MigrationClosedError extends Error {
  constructor(clubId: ClubId, closedAt: string) {
    super(
      `The migration into "${clubId}" was closed at ${closedAt}. Copying again could resurrect documents ` +
        'the live app has since deleted, so this run was refused.',
    );
    this.name = 'MigrationClosedError';
  }
}

/**
 * Marks the migration finished, so no later run can copy over (or back into)
 * live data. Idempotent; returns the timestamp recorded.
 */
export async function closeClubsMigration(db: Firestore, clubId: ClubId, now: string): Promise<string> {
  const ref = db.doc(paths.club(clubId));
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`${ref.path} does not exist — nothing has been migrated yet.`);
  const existing = snap.data()?.[CLOSED_FIELD] as string | undefined;
  if (existing) return existing;
  await ref.set({ [CLOSED_FIELD]: now }, { merge: true });
  return now;
}

export async function migrateToClubs(db: Firestore, opts: MigrateOptions): Promise<MigrationReport> {
  const closedAt = (await db.doc(paths.club(opts.clubId)).get()).data()?.[CLOSED_FIELD] as string | undefined;
  if (closedAt && opts.execute) throw new MigrationClosedError(opts.clubId, closedAt);

  const writes = new Writes(db, opts.execute);
  const report: MigrationReport = {
    clubId: opts.clubId,
    execute: opts.execute,
    clubDocCreated: false,
    collections: [],
    usersWritten: 0,
    totalWrites: 0,
  };

  const clubRef = db.doc(paths.club(opts.clubId));
  if (!(await clubRef.get()).exists) {
    report.clubDocCreated = true;
    await writes.set(clubRef.path, opts.club);
  }

  for (const pair of await collectionPairs(db, opts.clubId)) {
    const isMembers = pair.from === 'members';
    report.collections.push(
      await copyCollection(db, writes, pair.from, pair.to, async (memberDoc) => {
        if (!isMembers) return;
        // Whenever a membership is (re)copied, bring the person-level index
        // into line with its `active` flag (see `userClubsWrite`).
        const active = memberDoc.data().active === true;
        report.usersWritten += 1;
        await writes.set(
          paths.user(memberDoc.id),
          {
            id: memberDoc.id,
            clubIds: active ? FieldValue.arrayUnion(opts.clubId) : FieldValue.arrayRemove(opts.clubId),
            updatedAt: new Date().toISOString(),
          },
          true,
        );
      }),
    );
  }

  report.collections.push(await copyCollection(db, writes, LEGACY_PATHS.memberPrivate, paths.userPrivates()));

  await writes.flush();
  report.totalWrites = writes.total;
  return report;
}

export interface VerifyProblem {
  path: string;
  problem: 'missing' | 'differs' | 'user-index';
}

export interface VerifyReport {
  clubId: ClubId;
  /** Old documents checked. */
  checked: number;
  /** New copies that are newer than, and differ from, the old document — live changes, not problems. */
  keptNewer: number;
  onlyInNew: number;
  problems: VerifyProblem[];
}

/**
 * Read-only check that every old document has an up-to-date copy in the new
 * layout and that `users/{uid}.clubIds` agrees with each NEW membership's
 * `active` flag. `problems` empty means the new layout can be trusted.
 */
export async function verifyClubsMigration(db: Firestore, clubId: ClubId): Promise<VerifyReport> {
  const report: VerifyReport = { clubId, checked: 0, keptNewer: 0, onlyInNew: 0, problems: [] };

  if (!(await db.doc(paths.club(clubId)).get()).exists) {
    report.problems.push({ path: paths.club(clubId), problem: 'missing' });
  }

  const pairs = [
    ...(await collectionPairs(db, clubId)),
    { from: LEGACY_PATHS.memberPrivate as string, to: paths.userPrivates() },
  ];
  for (const { from, to } of pairs) {
    const [oldSnap, newSnap] = await Promise.all([db.collection(from).get(), db.collection(to).get()]);
    const newById = new Map(newSnap.docs.map((d) => [d.id, d]));
    const oldIds = new Set(oldSnap.docs.map((d) => d.id));
    for (const oldDoc of oldSnap.docs) {
      report.checked += 1;
      const decision = decide(oldDoc, newById.get(oldDoc.id));
      if (decision === 'created') report.problems.push({ path: `${to}/${oldDoc.id}`, problem: 'missing' });
      else if (decision === 'refreshed') report.problems.push({ path: `${to}/${oldDoc.id}`, problem: 'differs' });
      else if (decision === 'keptNewer') report.keptNewer += 1;
    }
    report.onlyInNew += newSnap.docs.filter((d) => !oldIds.has(d.id)).length;
  }

  const membersSnap = await db.collection(clubPaths(clubId).members()).get();
  for (const memberDoc of membersSnap.docs) {
    const userSnap = await db.doc(paths.user(memberDoc.id)).get();
    const clubIds = (userSnap.data()?.clubIds ?? []) as string[];
    const active = memberDoc.data().active === true;
    if (clubIds.includes(clubId) !== active) {
      report.problems.push({ path: paths.user(memberDoc.id), problem: 'user-index' });
    }
  }

  return report;
}

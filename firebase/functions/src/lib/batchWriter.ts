/**
 * Accumulates Firestore writes into batches of at most `MAX_OPS_PER_BATCH`
 * (plan §13: "Batch Firestore writes ≤ 400 per batch"), committing
 * automatically as it fills and via an explicit final `flush()`.
 *
 * Not a transaction — used for bulk imports where each row's writes are
 * already individually consistent (a full member doc + memberPrivate doc, or
 * a single field patch) and we only need write-count batching for cost, not
 * cross-row atomicity *between unrelated rows*.
 *
 * Batches ARE committed strictly in the order they were rotated out (each
 * commit only starts once the previous one has resolved), never
 * concurrently. This is load-bearing: a caller that deletes a document in
 * one op and re-creates it (same doc id) later in the same writer — e.g.
 * `runProgrammeImport`'s replace path, which deletes every existing session
 * then re-writes the full new set — can have that delete and its matching
 * recreate land in *different* batches once the op count crosses
 * `MAX_OPS_PER_BATCH`. Firing those batches' commits concurrently races them
 * against each other: whichever the backend happens to apply last wins,
 * so the recreate can be silently wiped out by the stale delete landing
 * after it (this was a real bug — see programmeImport.ts history). Awaiting
 * each commit before starting the next makes application order match call
 * order, so a same-doc delete-then-set always ends with the set applied.
 */
import type { DocumentData, DocumentReference, SetOptions } from 'firebase-admin/firestore';
import { db } from './admin.js';

const MAX_OPS_PER_BATCH = 400;

export class BatchWriter {
  private batch = db.batch();
  private opsInBatch = 0;
  /** Chain of commits so far; each rotate() appends onto the end of it. */
  private chain: Promise<unknown> = Promise.resolve();

  set(ref: DocumentReference, data: DocumentData, options?: SetOptions): void {
    if (options) {
      this.batch.set(ref, data, options);
    } else {
      this.batch.set(ref, data);
    }
    this.trackOp();
  }

  update(ref: DocumentReference, data: DocumentData): void {
    this.batch.update(ref, data);
    this.trackOp();
  }

  delete(ref: DocumentReference): void {
    this.batch.delete(ref);
    this.trackOp();
  }

  private trackOp(): void {
    this.opsInBatch += 1;
    if (this.opsInBatch >= MAX_OPS_PER_BATCH) {
      this.rotate();
    }
  }

  /**
   * Synchronously swaps in a fresh batch and queues the commit of the old
   * one onto the end of the commit chain — it will not start until every
   * batch rotated out before it has finished committing (see class doc).
   */
  private rotate(): void {
    const toCommit = this.batch;
    this.batch = db.batch();
    this.opsInBatch = 0;
    this.chain = this.chain.then(() => toCommit.commit());
  }

  /** Commits any pending writes and awaits the full chain of commits in order. */
  async flush(): Promise<void> {
    if (this.opsInBatch > 0) {
      this.rotate();
    }
    await this.chain;
  }
}

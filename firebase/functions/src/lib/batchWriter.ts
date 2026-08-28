/**
 * Accumulates Firestore writes into batches of at most `MAX_OPS_PER_BATCH`
 * (plan §13: "Batch Firestore writes ≤ 400 per batch"), committing
 * automatically as it fills and via an explicit final `flush()`.
 *
 * Not a transaction — used for bulk imports where each row's writes are
 * already individually consistent (a full member doc + memberPrivate doc, or
 * a single field patch) and we only need write-count batching for cost, not
 * cross-row atomicity.
 */
import type { DocumentData, DocumentReference, SetOptions } from 'firebase-admin/firestore';
import { db } from './admin.js';

const MAX_OPS_PER_BATCH = 400;

export class BatchWriter {
  private batch = db.batch();
  private opsInBatch = 0;
  private commits: Promise<unknown>[] = [];

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

  /** Synchronously swaps in a fresh batch and fires off the commit of the old one. */
  private rotate(): void {
    const toCommit = this.batch;
    this.batch = db.batch();
    this.opsInBatch = 0;
    this.commits.push(toCommit.commit());
  }

  /** Commits any pending writes and awaits every batch this writer has started. */
  async flush(): Promise<void> {
    if (this.opsInBatch > 0) {
      this.rotate();
    }
    const pending = this.commits;
    this.commits = [];
    await Promise.all(pending);
  }
}

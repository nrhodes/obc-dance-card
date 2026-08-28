/**
 * Writes `auditLog` entries (plan §5.10, §9). Called after the transaction
 * commits, whenever a callable acted `onBehalfOfMemberId`, plus for the
 * system-level actions (imports, publishes, broadcasts, role changes, sweep
 * repairs) listed in `AuditAction`.
 */
import { randomUUID } from 'node:crypto';
import type { AuditAction, AuditLogEntry } from '@obc/shared';
import { db } from './admin.js';

export interface AuditInput {
  actorMemberId: string;
  action: AuditAction;
  targetMemberId?: string;
  /** Firestore path of the affected document, when there is a single one. */
  entityRef?: string;
  before?: unknown;
  after?: unknown;
  detail?: Record<string, unknown>;
}

export async function audit(entry: AuditInput): Promise<void> {
  const id = randomUUID();
  const doc: AuditLogEntry = {
    id,
    at: new Date().toISOString(),
    actorMemberId: entry.actorMemberId,
    action: entry.action,
    targetMemberId: entry.targetMemberId,
    entityRef: entry.entityRef,
    before: entry.before,
    after: entry.after,
    detail: entry.detail,
  };
  // `ignoreUndefinedProperties` (set in lib/admin.ts) drops the unset optional
  // fields above rather than rejecting the write.
  await db.collection('auditLog').doc(id).set(doc);
}

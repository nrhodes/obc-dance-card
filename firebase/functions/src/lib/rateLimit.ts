/**
 * Fixed-window rate limiting backed by `rateLimits/{bucket}:{sha256(subject)}`
 * (plan §5.10, §8.1). `subject` is hashed so the document id never carries a
 * raw email address or IP.
 */
import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import type { RateLimit } from '@obc/shared';
import { db } from './admin.js';

function rateLimitKey(bucket: string, subject: string): string {
  const hash = createHash('sha256').update(subject).digest('hex');
  return `${bucket}:${hash}`;
}

/**
 * Throws `resource-exhausted` once `subject` has made more than `limit`
 * calls to `bucket` within the trailing `windowSec` seconds; otherwise
 * records this call and returns.
 */
export async function assertRateLimit(
  bucket: string,
  subject: string,
  limit: number,
  windowSec: number,
): Promise<void> {
  const ref = db.collection('rateLimits').doc(rateLimitKey(bucket, subject));
  const windowMs = windowSec * 1000;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();

    if (!snap.exists) {
      const fresh: RateLimit = { id: ref.id, windowStart: new Date(now).toISOString(), count: 1 };
      tx.set(ref, fresh);
      return;
    }

    const data = snap.data() as RateLimit;
    const windowStartMs = new Date(data.windowStart).getTime();

    if (now - windowStartMs >= windowMs) {
      const reset: RateLimit = { id: ref.id, windowStart: new Date(now).toISOString(), count: 1 };
      tx.set(ref, reset);
      return;
    }

    if (data.count >= limit) {
      throw new HttpsError('resource-exhausted', 'Too many requests. Please try again shortly.');
    }

    tx.update(ref, { count: data.count + 1 });
  });
}

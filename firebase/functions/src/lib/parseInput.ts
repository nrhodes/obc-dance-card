/**
 * Wraps a zod schema's `.parse` so malformed callable input surfaces as
 * `invalid-argument` with only the issue paths — never the offending values
 * — per plan §8.3's callable hardening checklist ("on failure throw
 * `invalid-argument` with the zod issue path only; no echo of values").
 *
 * Every callable MUST parse its input through this helper. A bare
 * `Schema.parse(req.data)` lets a raw `ZodError` escape as an opaque
 * `internal` error to the caller. A unit test (`parseInput.test.ts`) greps
 * the source tree to keep it that way.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import type { z } from 'zod';

export function parseInput<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const path = result.error.issues.map((issue) => issue.path.join('.') || '(root)').join(', ');
    throw new HttpsError('invalid-argument', `Invalid input: ${path}`);
  }
  return result.data;
}

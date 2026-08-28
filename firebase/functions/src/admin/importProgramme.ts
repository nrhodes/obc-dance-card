/**
 * `importProgramme` (plan §9.2, §13). Admin-only. Thin callable wrapper
 * around `runProgrammeImport` (see `programmeImport.ts` for the full
 * validation + write logic), which the seed script also drives directly.
 */
import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { ImportProgrammeInputSchema, type ImportProgrammeInput, type ProgrammeImportReport } from '@obc/shared';
import { callableOptions } from '../lib/callable.js';
import { requireAdmin } from '../lib/context.js';
import { runProgrammeImport } from './programmeImport.js';

export async function importProgrammeHandler(
  req: CallableRequest<ImportProgrammeInput>,
): Promise<ProgrammeImportReport> {
  const input = ImportProgrammeInputSchema.parse(req.data);
  const caller = await requireAdmin(req);
  return runProgrammeImport(input, caller.uid);
}

export const importProgramme = onCall({ ...callableOptions, timeoutSeconds: 300 }, importProgrammeHandler);

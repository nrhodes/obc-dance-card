/**
 * Default year for the programme import screen (plan Phase 2b task): "next
 * year if today is after 1 Oct NZ, else this year" — the club typically
 * imports next year's booklet from October onward.
 */
import { todayNZ } from '@obc/shared';

export function defaultProgrammeImportYear(now: Date = new Date()): number {
  const today = todayNZ(now);
  const [yearStr, monthStr] = today.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  return month >= 10 ? year + 1 : year;
}

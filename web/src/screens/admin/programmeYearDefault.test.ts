import { describe, expect, it } from 'vitest';
import { defaultProgrammeImportYear } from './programmeYearDefault';

describe('defaultProgrammeImportYear', () => {
  it('defaults to this year before 1 Oct NZ', () => {
    // 2026-09-30T00:00:00Z is NZDT+13 -> 2026-09-30 13:00 NZ, still September.
    expect(defaultProgrammeImportYear(new Date('2026-09-30T00:00:00Z'))).toBe(2026);
  });

  it('defaults to next year on/after 1 Oct NZ', () => {
    // 2026-10-01T00:00:00Z is NZDT+13 -> 2026-10-01 13:00 NZ, October.
    expect(defaultProgrammeImportYear(new Date('2026-10-01T00:00:00Z'))).toBe(2027);
  });
});

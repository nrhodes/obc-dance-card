import { describe, expect, it } from 'vitest';
import { redactImportReport } from './importReport.js';

describe('redactImportReport (security review L9)', () => {
  it('drops the raw CSV cells from every error and keeps everything else', () => {
    const report = {
      importId: 'x',
      added: 1,
      errors: [
        { file: 'members', row: 3, message: 'email: "a@b.c" is not valid', raw: { firstName: 'A', email: 'a@b.c', phone: '021' } },
        { file: 'members', row: 4, message: 'no raw here' },
      ],
      warnings: ['w'],
    };
    const stored = redactImportReport(report);
    expect(stored.errors).toEqual([
      { file: 'members', row: 3, message: 'email: "a@b.c" is not valid' },
      { file: 'members', row: 4, message: 'no raw here' },
    ]);
    expect(stored.added).toBe(1);
    expect(stored.warnings).toEqual(['w']);
    // The caller's copy is untouched — the admin still sees the raw row on screen.
    expect(report.errors[0]).toHaveProperty('raw');
  });
});

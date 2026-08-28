import { describe, expect, it } from 'vitest';
import { groupErrorsByFile, isAlreadyPublishedError, isWouldRemoveSessionsError } from './programmeImportErrors';

describe('isAlreadyPublishedError', () => {
  it('matches the exact backend wording', () => {
    expect(isAlreadyPublishedError('Programme 2027 is already published. Pass replace: true to re-import over it.')).toBe(true);
  });

  it('does not match an unrelated message', () => {
    expect(isAlreadyPublishedError('label is required')).toBe(false);
  });
});

describe('isWouldRemoveSessionsError', () => {
  it('matches the exact backend wording', () => {
    expect(
      isWouldRemoveSessionsError(
        'Replacing programme 2027 would remove 2 session(s) with active entries: 2027-01-11 (s1). Cancel those entries first.',
      ),
    ).toBe(true);
  });

  it('does not match the already-published message', () => {
    expect(isWouldRemoveSessionsError('Programme 2027 is already published. Pass replace: true to re-import over it.')).toBe(false);
  });
});

describe('groupErrorsByFile', () => {
  it('groups in weekdays/series/singles order regardless of input order', () => {
    const grouped = groupErrorsByFile([
      { file: 'singles', row: 1, message: 'a' },
      { file: 'series', row: 2, message: 'b' },
      { file: 'weekdays', row: 3, message: 'c' },
      { file: 'series', row: 4, message: 'd' },
    ]);
    expect(grouped.map((g) => g.file)).toEqual(['weekdays', 'series', 'singles']);
    expect(grouped.find((g) => g.file === 'series')!.errors).toHaveLength(2);
  });

  it('returns an empty array for no errors', () => {
    expect(groupErrorsByFile([])).toEqual([]);
  });
});

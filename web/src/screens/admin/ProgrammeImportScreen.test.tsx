import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ProgrammeImportReport } from '@obc/shared';
import { ProgrammeImportScreen } from './ProgrammeImportScreen';

const importProgrammeMock = vi.fn();

vi.mock('../../api', () => ({
  importProgramme: (...args: unknown[]) => importProgrammeMock(...args),
  publishProgramme: vi.fn(),
}));

vi.mock('../../firebase', () => ({
  toAppError: (err: unknown) => err,
}));

// The admin programme list and the series/session editor each have their own
// Firestore subscriptions (tested via their own modules / the E2E suite);
// stub them out here so these tests exercise only the import form's
// gating/report/replace logic.
vi.mock('./AdminProgrammeList', () => ({
  AdminProgrammeList: () => null,
}));

vi.mock('./ProgrammeEditor', () => ({
  ProgrammeEditor: () => null,
}));

function emptyReport(overrides: Partial<ProgrammeImportReport> = {}): ProgrammeImportReport {
  return {
    importId: 'import-1',
    year: 2027,
    weekdays: 0,
    series: 0,
    sessions: 0,
    errors: [],
    warnings: [],
    wouldRemoveSessions: 0,
    ...overrides,
  };
}

async function fillAllFiles(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('weekdays.csv contents'), 'weekday,label,startTime,seatedBy,stewardEmail,notes\n');
  await user.type(screen.getByLabelText('series.csv contents'), 'weekday,name,scoring,format,bestOfN,bestOfM,allowSubstitute,eligibilityNote,note,dates\n');
  await user.type(screen.getByLabelText('singles.csv contents'), 'date,weekday,kind,title,partnerRequired\n');
}

describe('ProgrammeImportScreen dry-run-before-import gating', () => {
  it('disables Import until a dry run of the exact same inputs has been reviewed', async () => {
    importProgrammeMock.mockResolvedValueOnce(emptyReport({ weekdays: 1, series: 1, sessions: 4 }));
    const user = userEvent.setup();
    render(<ProgrammeImportScreen />);

    const importButton = screen.getByRole('button', { name: /^Import$/ });
    expect(importButton).toHaveProperty('disabled', true);

    await fillAllFiles(user);
    expect(importButton).toHaveProperty('disabled', true);

    await user.click(screen.getByRole('button', { name: 'Check files (dry run)' }));
    expect(importProgrammeMock).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, replace: false, year: expect.any(Number) }),
    );

    expect(await screen.findByText('Sessions: 4')).toBeTruthy();
    expect(importButton).toHaveProperty('disabled', false);
  });

  it('re-locks Import after any file is edited', async () => {
    importProgrammeMock.mockResolvedValueOnce(emptyReport());
    const user = userEvent.setup();
    render(<ProgrammeImportScreen />);

    await fillAllFiles(user);
    await user.click(screen.getByRole('button', { name: 'Check files (dry run)' }));
    await screen.findByText('Sessions: 0');

    const importButton = screen.getByRole('button', { name: /^Import$/ });
    expect(importButton).toHaveProperty('disabled', false);

    await user.type(screen.getByLabelText('series.csv contents'), 'x');
    expect(importButton).toHaveProperty('disabled', true);
  });

  it('re-locks Import after the year changes', async () => {
    importProgrammeMock.mockResolvedValueOnce(emptyReport());
    const user = userEvent.setup();
    render(<ProgrammeImportScreen />);

    await fillAllFiles(user);
    await user.click(screen.getByRole('button', { name: 'Check files (dry run)' }));
    await screen.findByText('Sessions: 0');

    const yearInput = screen.getByLabelText('Year');
    await user.clear(yearInput);
    await user.type(yearInput, '2099');
    expect(screen.getByRole('button', { name: /^Import$/ })).toHaveProperty('disabled', true);
  });
});

describe('ProgrammeImportScreen error handling', () => {
  it('shows a Replace checkbox on the "already published" failed-precondition error', async () => {
    importProgrammeMock.mockRejectedValueOnce({
      code: 'failed-precondition',
      message: 'Programme 2027 is already published. Pass replace: true to re-import over it.',
    });
    const user = userEvent.setup();
    render(<ProgrammeImportScreen />);

    await fillAllFiles(user);
    await user.click(screen.getByRole('button', { name: 'Check files (dry run)' }));

    expect(await screen.findByText('Replace existing programme')).toBeTruthy();
    const checkbox = screen.getByRole('checkbox', { name: 'Replace existing programme' });
    expect(checkbox).toHaveProperty('checked', false);
    await user.click(checkbox);
    expect(checkbox).toHaveProperty('checked', true);
  });

  it('renders the "would remove sessions" error verbatim', async () => {
    const message = 'Replacing programme 2027 would remove 2 session(s) with active entries: 2027-01-11 (s1). Cancel those entries first.';
    importProgrammeMock.mockRejectedValueOnce({ code: 'failed-precondition', message });
    const user = userEvent.setup();
    render(<ProgrammeImportScreen />);

    await fillAllFiles(user);
    await user.click(screen.getByRole('button', { name: 'Check files (dry run)' }));

    expect(await screen.findByText(message)).toBeTruthy();
  });

  it('groups row errors by file', async () => {
    importProgrammeMock.mockResolvedValueOnce(
      emptyReport({
        errors: [
          { file: 'series', row: 2, message: 'bad scoring value' },
          { file: 'weekdays', row: 1, message: 'label is required' },
        ],
      }),
    );
    const user = userEvent.setup();
    render(<ProgrammeImportScreen />);

    await fillAllFiles(user);
    await user.click(screen.getByRole('button', { name: 'Check files (dry run)' }));

    const weekdaysHeading = await screen.findByText('Errors — weekdays.csv');
    const seriesHeading = screen.getByText('Errors — series.csv');
    expect(weekdaysHeading.compareDocumentPosition(seriesHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('label is required')).toBeTruthy();
    expect(screen.getByText('bad scoring value')).toBeTruthy();
  });
});

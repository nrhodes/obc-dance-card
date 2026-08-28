import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MemberImportReport } from '@obc/shared';
import { MembersImportScreen } from './MembersImportScreen';
import { isMassDeactivationWarning } from './massDeactivationWarning';

const importMembersMock = vi.fn();

vi.mock('../../api', () => ({
  importMembers: (...args: unknown[]) => importMembersMock(...args),
}));

vi.mock('../../firebase', () => ({
  toAppError: (err: unknown) => err,
}));

function emptyReport(overrides: Partial<MemberImportReport> = {}): MemberImportReport {
  return {
    importId: 'import-1',
    added: 0,
    updated: 0,
    deactivated: 0,
    unchanged: 0,
    errors: [],
    warnings: [],
    ...overrides,
  };
}

describe('isMassDeactivationWarning', () => {
  it('matches the exact backend warning wording', () => {
    expect(
      isMassDeactivationWarning(
        'This file would deactivate 12 of 20 active members (threshold 5). No one was deactivated. ' +
          'If this is intended, re-run with allowMassDeactivation: true.',
      ),
    ).toBe(true);
  });

  it('does not match unrelated warnings', () => {
    expect(isMassDeactivationWarning('Some other warning entirely')).toBe(false);
  });
});

describe('MembersImportScreen dry-run-before-import gating', () => {
  it('disables Import until a dry run of the exact same text has been reviewed', async () => {
    importMembersMock.mockResolvedValueOnce(emptyReport({ added: 2 }));
    const user = userEvent.setup();
    render(<MembersImportScreen />);

    const importButton = screen.getByRole('button', { name: /^Import$/ });
    expect(importButton).toHaveProperty('disabled', true);

    const textarea = screen.getByLabelText('Or paste the CSV contents');
    await user.type(textarea, 'firstName,lastName,email,phone,grade\nJane,Doe,jane@example.org,,Open\n');

    // Text entered but not yet dry-run: still disabled.
    expect(importButton).toHaveProperty('disabled', true);

    await user.click(screen.getByRole('button', { name: 'Check file (dry run)' }));
    expect(importMembersMock).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, allowMassDeactivation: false }),
    );

    expect(await screen.findByText('Added: 2')).toBeTruthy();
    expect(importButton).toHaveProperty('disabled', false);
  });

  it('re-locks Import after the reviewed text is edited', async () => {
    importMembersMock.mockResolvedValueOnce(emptyReport({ added: 1 }));
    const user = userEvent.setup();
    render(<MembersImportScreen />);

    const textarea = screen.getByLabelText('Or paste the CSV contents');
    await user.type(textarea, 'a');
    await user.click(screen.getByRole('button', { name: 'Check file (dry run)' }));
    await screen.findByText('Added: 1');

    const importButton = screen.getByRole('button', { name: /^Import$/ });
    expect(importButton).toHaveProperty('disabled', false);

    await user.type(textarea, 'b');
    expect(importButton).toHaveProperty('disabled', true);
  });

  it('offers the mass-deactivation checkbox only when that warning is present', async () => {
    importMembersMock.mockResolvedValueOnce(
      emptyReport({
        warnings: [
          'This file would deactivate 12 of 20 active members (threshold 5). No one was deactivated. ' +
            'If this is intended, re-run with allowMassDeactivation: true.',
        ],
      }),
    );
    const user = userEvent.setup();
    render(<MembersImportScreen />);

    await user.type(screen.getByLabelText('Or paste the CSV contents'), 'a');
    await user.click(screen.getByRole('button', { name: 'Check file (dry run)' }));

    expect(await screen.findByText('Yes, deactivate these members')).toBeTruthy();
  });

  it('renders the error table with row and message', async () => {
    importMembersMock.mockResolvedValueOnce(
      emptyReport({ errors: [{ file: 'members', row: 3, message: 'email is not valid' }] }),
    );
    const user = userEvent.setup();
    render(<MembersImportScreen />);

    await user.type(screen.getByLabelText('Or paste the CSV contents'), 'a');
    await user.click(screen.getByRole('button', { name: 'Check file (dry run)' }));

    expect(await screen.findByText('email is not valid')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });
});

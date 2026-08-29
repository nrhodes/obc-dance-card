/**
 * Admin: Integrity (plan §7, §9.2 `runPairingSweep`, Phase 6b task
 * deliverable 6 + Tests section: "integrity screen states").
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IntegrityScreen } from './IntegrityScreen';

const runPairingSweepMock = vi.fn();
vi.mock('../../api', () => ({
  runPairingSweep: (...args: unknown[]) => runPairingSweepMock(...args),
}));

beforeEach(() => {
  runPairingSweepMock.mockReset();
});

function renderScreen() {
  return render(
    <MemoryRouter>
      <IntegrityScreen />
    </MemoryRouter>,
  );
}

describe('IntegrityScreen', () => {
  it('Run check with no violations', async () => {
    runPairingSweepMock.mockResolvedValueOnce({ checkedSessions: 10, checkedTeams: 2, violations: [], repaired: 0 });
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: 'Run check' }));
    expect(runPairingSweepMock).toHaveBeenCalledWith({ repair: false });
    expect(await screen.findByText('No violations found.')).toBeTruthy();
    expect(screen.getByText('Sessions checked: 10')).toBeTruthy();
  });

  it('Run check with violations lists kind, id, and issues', async () => {
    runPairingSweepMock.mockResolvedValueOnce({
      checkedSessions: 3,
      checkedTeams: 0,
      violations: [{ kind: 'pairing', id: 'session-1', issues: ['mismatched partner'] }],
      repaired: 0,
    });
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: 'Run check' }));
    expect(await screen.findByText('pairing')).toBeTruthy();
    expect(screen.getByText('session-1')).toBeTruthy();
    expect(screen.getByText('mismatched partner')).toBeTruthy();
  });

  it('Run check and repair requires confirmation, then shows the repaired count and a link to the audit log', async () => {
    runPairingSweepMock.mockResolvedValueOnce({ checkedSessions: 5, checkedTeams: 1, violations: [], repaired: 3 });
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: 'Run check and repair' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/cannot be undone/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Run check and repair' }));
    expect(runPairingSweepMock).toHaveBeenCalledWith({ repair: true });
    expect(await screen.findByText('Repaired: 3')).toBeTruthy();
    const link = screen.getByRole('link', { name: /audit log/ });
    expect(link.getAttribute('href')).toBe('/admin/audit?action=pairing_repair');
  });

  it('maps a server error verbatim', async () => {
    runPairingSweepMock.mockRejectedValueOnce({ code: 'failed-precondition', message: 'Sweep already running.' });
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: 'Run check' }));
    expect(await screen.findByText('Sweep already running.')).toBeTruthy();
  });
});

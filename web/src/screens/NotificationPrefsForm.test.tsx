import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_NOTIFICATION_PREFS } from '@obc/shared';
import { NotificationPrefsForm } from './NotificationPrefsForm';

const updateMyPrefsMock = vi.fn();

vi.mock('../api', () => ({
  updateMyPrefs: (...args: unknown[]) => updateMyPrefsMock(...args),
}));

vi.mock('../firebase', () => ({
  toAppError: (err: unknown) => err,
}));

describe('NotificationPrefsForm', () => {
  it('renders the defaults when no prefs exist yet, and saves edits', async () => {
    updateMyPrefsMock.mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup();
    render(<NotificationPrefsForm initialPrefs={undefined} />);

    const pushCheckbox = screen.getByLabelText('Push notifications') as HTMLInputElement;
    expect(pushCheckbox.checked).toBe(DEFAULT_NOTIFICATION_PREFS.push);

    await user.click(pushCheckbox);
    expect(pushCheckbox.checked).toBe(!DEFAULT_NOTIFICATION_PREFS.push);

    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect(updateMyPrefsMock).toHaveBeenCalledWith({
      ...DEFAULT_NOTIFICATION_PREFS,
      push: !DEFAULT_NOTIFICATION_PREFS.push,
    });
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('shows the reminder-days select only while reminders are on', async () => {
    const user = userEvent.setup();
    render(<NotificationPrefsForm initialPrefs={{ ...DEFAULT_NOTIFICATION_PREFS, reminders: true }} />);

    expect(screen.getByLabelText('Remind me this many days before')).toBeTruthy();

    await user.click(screen.getByLabelText('Session reminders'));

    expect(screen.queryByLabelText('Remind me this many days before')).toBeNull();
  });

  it('shows a generic error and no raw detail when saving fails', async () => {
    updateMyPrefsMock.mockRejectedValueOnce({ code: 'internal', message: 'raw backend detail' });
    const user = userEvent.setup();
    render(<NotificationPrefsForm initialPrefs={DEFAULT_NOTIFICATION_PREFS} />);

    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Something went wrong/);
    expect(alert.textContent).not.toContain('raw backend detail');
  });
});

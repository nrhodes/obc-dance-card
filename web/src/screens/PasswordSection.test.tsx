/**
 * PasswordSection — the inline re-auth flow (audit M1, plan §8.2 amended):
 * when `setPassword` rejects with `details.reason = 'recent-login-required'`,
 * the member stays in the password section (no navigation), the emailed-code
 * step appears inline, and a successful verify retries `setPassword`
 * automatically with the password the member had already typed.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RECENT_LOGIN_REQUIRED_REASON } from '@obc/shared';
import { PasswordSection } from './PasswordSection';

const setPasswordMock = vi.fn();
const removePasswordMock = vi.fn();
const requestLoginCodeMock = vi.fn();
const verifyLoginCodeMock = vi.fn();
const signInWithCustomTokenMock = vi.fn();

vi.mock('../api', () => ({
  setPassword: (...args: unknown[]) => setPasswordMock(...args),
  removePassword: (...args: unknown[]) => removePasswordMock(...args),
  requestLoginCode: (...args: unknown[]) => requestLoginCodeMock(...args),
  verifyLoginCode: (...args: unknown[]) => verifyLoginCodeMock(...args),
}));

vi.mock('../firebase', () => ({
  auth: {},
  // Identity passthrough: the tests throw AppError-shaped objects directly.
  toAppError: (err: unknown) => err,
}));

vi.mock('firebase/auth', () => ({
  signInWithCustomToken: (...args: unknown[]) => signInWithCustomTokenMock(...args),
}));

const RECENT_LOGIN_ERROR = {
  code: 'failed-precondition',
  message: "For your security, please confirm it's you first.",
  details: { reason: RECENT_LOGIN_REQUIRED_REASON },
};

afterEach(() => {
  setPasswordMock.mockReset();
  removePasswordMock.mockReset();
  requestLoginCodeMock.mockReset();
  verifyLoginCodeMock.mockReset();
  signInWithCustomTokenMock.mockReset();
});

async function typeAndSubmitPassword(pw = 'goodpass1') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('New password'), pw);
  await user.type(screen.getByLabelText('Confirm password'), pw);
  await user.click(screen.getByRole('button', { name: 'Set password' }));
  return user;
}

describe('PasswordSection — set password with a fresh session', () => {
  it('sets the password with no code step when the session is recent', async () => {
    setPasswordMock.mockResolvedValue({ ok: true });
    render(<PasswordSection hasPassword={false} email="alice@example.org" />);

    await typeAndSubmitPassword();

    expect(setPasswordMock).toHaveBeenCalledWith({ password: 'goodpass1' });
    expect(await screen.findByText('Password set.')).toBeTruthy();
    expect(screen.queryByLabelText('6-digit code')).toBeNull();
    expect(requestLoginCodeMock).not.toHaveBeenCalled();
  });
});

describe('PasswordSection — inline re-auth (audit M1)', () => {
  it('shows the code step inline on a stale session, without unmounting the section', async () => {
    setPasswordMock.mockRejectedValueOnce(RECENT_LOGIN_ERROR);
    requestLoginCodeMock.mockResolvedValue({ ok: true });
    render(<PasswordSection hasPassword={false} email="alice@example.org" />);

    await typeAndSubmitPassword();

    // Still the password section's heading — no navigation, no unmount.
    expect(screen.getByRole('heading', { name: 'Set a password (optional)' })).toBeTruthy();
    expect(await screen.findByLabelText('6-digit code')).toBeTruthy();
    // The first code is requested automatically for the member's own email.
    await waitFor(() => expect(requestLoginCodeMock).toHaveBeenCalledWith({ email: 'alice@example.org' }));
  });

  it('verifies the code, refreshes the session, and retries with the kept password', async () => {
    setPasswordMock.mockRejectedValueOnce(RECENT_LOGIN_ERROR).mockResolvedValueOnce({ ok: true });
    requestLoginCodeMock.mockResolvedValue({ ok: true });
    verifyLoginCodeMock.mockResolvedValue({ token: 'custom-token-123' });
    signInWithCustomTokenMock.mockResolvedValue({});
    render(<PasswordSection hasPassword={false} email="alice@example.org" />);

    const user = await typeAndSubmitPassword('goodpass1');

    await user.type(await screen.findByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(signInWithCustomTokenMock).toHaveBeenCalled());
    expect(verifyLoginCodeMock).toHaveBeenCalledWith({ email: 'alice@example.org', code: '123456' });
    // The retry reuses the password typed before the code step appeared.
    expect(setPasswordMock).toHaveBeenNthCalledWith(2, { password: 'goodpass1' });
    expect(await screen.findByText('Password set.')).toBeTruthy();
  });

  it('keeps the typed password when the member cancels the code step', async () => {
    setPasswordMock.mockRejectedValueOnce(RECENT_LOGIN_ERROR);
    requestLoginCodeMock.mockResolvedValue({ ok: true });
    render(<PasswordSection hasPassword={false} email="alice@example.org" />);

    const user = await typeAndSubmitPassword('goodpass1');
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    const input = screen.getByLabelText('New password') as HTMLInputElement;
    expect(input.value).toBe('goodpass1');
  });

  it('shows an inline error for a wrong code and allows retrying', async () => {
    setPasswordMock.mockRejectedValueOnce(RECENT_LOGIN_ERROR);
    requestLoginCodeMock.mockResolvedValue({ ok: true });
    verifyLoginCodeMock.mockRejectedValueOnce({ code: 'invalid-argument', message: 'That code is not right.' });
    render(<PasswordSection hasPassword={false} email="alice@example.org" />);

    const user = await typeAndSubmitPassword();
    await user.type(await screen.findByLabelText('6-digit code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    // Wrong code: the code step stays up (EmailCodeStep shows its own error)
    // and setPassword is NOT retried.
    await waitFor(() => expect(verifyLoginCodeMock).toHaveBeenCalled());
    expect(setPasswordMock).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('6-digit code')).toBeTruthy();
  });

  it('surfaces a non-reauth failure as a normal form error, not the code step', async () => {
    setPasswordMock.mockRejectedValueOnce({ code: 'unavailable', message: 'busy' });
    render(<PasswordSection hasPassword={false} email="alice@example.org" />);

    await typeAndSubmitPassword();

    expect(screen.queryByLabelText('6-digit code')).toBeNull();
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

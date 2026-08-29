import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignInScreen } from './SignInScreen';

const requestLoginCodeMock = vi.fn();
const verifyLoginCodeMock = vi.fn();
const signInWithCustomTokenMock = vi.fn();
const signInWithEmailAndPasswordMock = vi.fn();

vi.mock('../api', () => ({
  requestLoginCode: (...args: unknown[]) => requestLoginCodeMock(...args),
  verifyLoginCode: (...args: unknown[]) => verifyLoginCodeMock(...args),
}));

vi.mock('../firebase', () => ({
  auth: {},
  toAppError: (err: unknown) => err,
}));

vi.mock('firebase/auth', () => ({
  signInWithCustomToken: (...args: unknown[]) => signInWithCustomTokenMock(...args),
  signInWithEmailAndPassword: (...args: unknown[]) => signInWithEmailAndPasswordMock(...args),
}));

afterEach(() => {
  vi.useRealTimers();
  requestLoginCodeMock.mockReset();
  verifyLoginCodeMock.mockReset();
  signInWithCustomTokenMock.mockReset();
  signInWithEmailAndPasswordMock.mockReset();
});

describe('SignInScreen — email -> code step -> verify -> signed in', () => {
  it('disables "Email me a code" until the email looks valid', async () => {
    const user = userEvent.setup();
    render(<SignInScreen />, { wrapper: MemoryRouter });

    const sendCodeButton = screen.getByRole('button', { name: 'Email me a code' });
    expect(sendCodeButton).toHaveProperty('disabled', true);

    await user.type(screen.getByLabelText('Email address'), 'member@example.org');
    expect(sendCodeButton).toHaveProperty('disabled', false);
  });

  it('requests a code and shows the code step with no clickable "link" wording', async () => {
    requestLoginCodeMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<SignInScreen />, { wrapper: MemoryRouter });

    await user.type(screen.getByLabelText('Email address'), 'member@example.org');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));

    expect(
      await screen.findByText(/We've emailed a 6-digit code to member@example.org/),
    ).toBeTruthy();
    expect(requestLoginCodeMock).toHaveBeenCalledWith({ email: 'member@example.org' });
    // No auth email should ever tell someone to click a link.
    expect(document.body.textContent).not.toMatch(/click.*link/i);
  });

  it('verifies the code and signs in with the returned custom token', async () => {
    requestLoginCodeMock.mockResolvedValue({ ok: true });
    verifyLoginCodeMock.mockResolvedValue({ token: 'custom-token-abc' });
    const user = userEvent.setup();
    render(<SignInScreen />, { wrapper: MemoryRouter });

    await user.type(screen.getByLabelText('Email address'), 'member@example.org');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    await screen.findByLabelText('6-digit code');

    await user.type(screen.getByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(verifyLoginCodeMock).toHaveBeenCalledWith({
      email: 'member@example.org',
      code: '123456',
    });
    await vi.waitFor(() =>
      expect(signInWithCustomTokenMock).toHaveBeenCalledWith({}, 'custom-token-abc'),
    );
  });

  it('maps an invalid-code error without ever showing the raw backend message', async () => {
    requestLoginCodeMock.mockResolvedValue({ ok: true });
    verifyLoginCodeMock.mockRejectedValue({
      code: 'invalid-argument',
      message: 'HMAC mismatch for hash xyz',
    });
    const user = userEvent.setup();
    render(<SignInScreen />, { wrapper: MemoryRouter });

    await user.type(screen.getByLabelText('Email address'), 'member@example.org');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/not valid/);
    expect(alert.textContent).not.toContain('HMAC');
  });

  it('maps a rate-limit error to the "too many attempts" message', async () => {
    requestLoginCodeMock.mockRejectedValue({ code: 'resource-exhausted', message: 'x' });
    const user = userEvent.setup();
    render(<SignInScreen />, { wrapper: MemoryRouter });

    await user.type(screen.getByLabelText('Email address'), 'member@example.org');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Too many attempts/);
  });

  it('disables resend immediately after sending, and re-enables it after the cooldown', async () => {
    // Fake timers are engaged for the whole interaction (including the
    // click that triggers the countdown's `setInterval`) — see
    // useEmailCodeFlow.test.ts for the underlying reducer/state-transition
    // coverage. Plain `fireEvent` (no artificial delay) is used instead of
    // `userEvent` to avoid it needing its own fake-timer wiring.
    vi.useFakeTimers();
    try {
      requestLoginCodeMock.mockResolvedValue({ ok: true });
      render(<SignInScreen />, { wrapper: MemoryRouter });

      fireEvent.change(screen.getByLabelText('Email address'), {
        target: { value: 'member@example.org' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));

      // Flush the mocked requestLoginCode()'s microtask chain — fake timers
      // only virtualise setTimeout/setInterval/Date, not promise microtasks.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      const resendButton = screen.getByRole('button', { name: /Send a new code/ });
      expect(resendButton).toHaveProperty('disabled', true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(61_000);
      });

      expect(resendButton.textContent).toBe('Send a new code');
      expect(resendButton).toHaveProperty('disabled', false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('"Use a different email" returns to the chooser step', async () => {
    requestLoginCodeMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<SignInScreen />, { wrapper: MemoryRouter });

    await user.type(screen.getByLabelText('Email address'), 'member@example.org');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    await screen.findByLabelText('6-digit code');

    await user.click(screen.getByRole('button', { name: 'Use a different email' }));

    expect(screen.getByRole('button', { name: 'Email me a code' })).toBeTruthy();
  });
});

describe('SignInScreen — password path', () => {
  it('reveals the password field on request', async () => {
    const user = userEvent.setup();
    render(<SignInScreen />, { wrapper: MemoryRouter });

    expect(screen.queryByLabelText('Password')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'I have a password' }));
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('shows one generic message for both wrong-password and unknown-user, never a raw Firebase error', async () => {
    signInWithEmailAndPasswordMock.mockRejectedValue({
      code: 'auth/wrong-password',
      message: 'INVALID_PASSWORD',
    });
    const user = userEvent.setup();
    render(<SignInScreen />, { wrapper: MemoryRouter });

    await user.type(screen.getByLabelText('Email address'), 'member@example.org');
    await user.click(screen.getByRole('button', { name: 'I have a password' }));
    await user.type(screen.getByLabelText('Password'), 'whatever123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/don't match/);
    expect(alert.textContent).not.toContain('INVALID_PASSWORD');
  });
});

import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OfflineBanner } from './OfflineBanner';

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
}

afterEach(() => {
  setOnline(true);
});

describe('OfflineBanner', () => {
  it('renders nothing while online', () => {
    setOnline(true);
    render(<OfflineBanner />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a plain-language message while offline', () => {
    setOnline(false);
    render(<OfflineBanner />);
    expect(screen.getByRole('status').textContent).toMatch(/offline.*card may be out of date/i);
  });

  it('reacts to the offline/online window events', () => {
    setOnline(true);
    render(<OfflineBanner />);
    expect(screen.queryByRole('status')).toBeNull();

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('status')).toBeTruthy();

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});

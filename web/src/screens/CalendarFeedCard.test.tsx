import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CalendarFeedCard } from './CalendarFeedCard';

const getIcalFeedMock = vi.fn();
const createIcalFeedMock = vi.fn();
const rotateIcalFeedMock = vi.fn();
const removeIcalFeedMock = vi.fn();

vi.mock('../api', () => ({
  getIcalFeed: (...args: unknown[]) => getIcalFeedMock(...args),
  createIcalFeed: (...args: unknown[]) => createIcalFeedMock(...args),
  rotateIcalFeed: (...args: unknown[]) => rotateIcalFeedMock(...args),
  removeIcalFeed: (...args: unknown[]) => removeIcalFeedMock(...args),
}));

vi.mock('../firebase', () => ({
  toAppError: (err: unknown) => err,
}));

const URL_HTTPS = 'http://localhost:5173/ical/abc123.ics';
const URL_WEBCAL = 'webcal://localhost:5173/ical/abc123.ics';

beforeEach(() => {
  getIcalFeedMock.mockReset();
  createIcalFeedMock.mockReset();
  rotateIcalFeedMock.mockReset();
  removeIcalFeedMock.mockReset();
});

describe('CalendarFeedCard', () => {
  it('no feed yet: shows "Create calendar link", then the URL after creating', async () => {
    getIcalFeedMock.mockResolvedValueOnce({ url: null });
    createIcalFeedMock.mockResolvedValueOnce({ url: URL_HTTPS, webcalUrl: URL_WEBCAL });
    const user = userEvent.setup();

    render(<CalendarFeedCard />);

    const createButton = await screen.findByRole('button', { name: 'Create calendar link' });
    await user.click(createButton);

    expect(createIcalFeedMock).toHaveBeenCalledWith({});
    const input = (await screen.findByLabelText('Your calendar link')) as HTMLInputElement;
    expect(input.value).toBe(URL_HTTPS);
    expect(screen.getByRole('link', { name: 'Open in Apple Calendar' }).getAttribute('href')).toBe(URL_WEBCAL);
  });

  it('feed exists: shows the URL on mount and offers reset/remove', async () => {
    getIcalFeedMock.mockResolvedValueOnce({
      url: URL_HTTPS,
      webcalUrl: URL_WEBCAL,
      createdAt: '2027-01-01T00:00:00.000Z',
    });

    render(<CalendarFeedCard />);

    const input = (await screen.findByLabelText('Your calendar link')) as HTMLInputElement;
    expect(input.value).toBe(URL_HTTPS);
    expect(screen.queryByRole('button', { name: 'Create calendar link' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reset link' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove link' })).toBeTruthy();
  });

  it('reset flow: confirming rotates the link and shows the new URL', async () => {
    getIcalFeedMock.mockResolvedValueOnce({
      url: URL_HTTPS,
      webcalUrl: URL_WEBCAL,
      createdAt: '2027-01-01T00:00:00.000Z',
    });
    const newUrl = 'http://localhost:5173/ical/def456.ics';
    rotateIcalFeedMock.mockResolvedValueOnce({ url: newUrl, webcalUrl: 'webcal://localhost:5173/ical/def456.ics' });
    const user = userEvent.setup();

    render(<CalendarFeedCard />);
    await screen.findByLabelText('Your calendar link');

    await user.click(screen.getByRole('button', { name: 'Reset link' }));
    const dialog = await screen.findByRole('dialog');
    expect(screen.getByText(/current subscription will stop working/)).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Reset link' }));

    await waitFor(() => expect(rotateIcalFeedMock).toHaveBeenCalledWith({}));
    const input = (await screen.findByLabelText('Your calendar link')) as HTMLInputElement;
    expect(input.value).toBe(newUrl);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('remove flow: confirming clears the feed back to "Create calendar link"', async () => {
    getIcalFeedMock.mockResolvedValueOnce({
      url: URL_HTTPS,
      webcalUrl: URL_WEBCAL,
      createdAt: '2027-01-01T00:00:00.000Z',
    });
    removeIcalFeedMock.mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup();

    render(<CalendarFeedCard />);
    await screen.findByLabelText('Your calendar link');

    await user.click(screen.getByRole('button', { name: 'Remove link' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove link' }));

    await waitFor(() => expect(removeIcalFeedMock).toHaveBeenCalledWith({}));
    expect(await screen.findByRole('button', { name: 'Create calendar link' })).toBeTruthy();
    expect(screen.queryByLabelText('Your calendar link')).toBeNull();
  });

  it('shows a generic error and no raw detail when creating fails', async () => {
    getIcalFeedMock.mockResolvedValueOnce({ url: null });
    createIcalFeedMock.mockRejectedValueOnce({ code: 'internal', message: 'raw backend detail' });
    const user = userEvent.setup();

    render(<CalendarFeedCard />);
    await user.click(await screen.findByRole('button', { name: 'Create calendar link' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toContain('raw backend detail');
  });
});

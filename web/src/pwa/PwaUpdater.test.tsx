import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PwaUpdater } from './PwaUpdater';

let statusFixture: string = 'signedOut';
let needsRefreshFixture = false;
const reloadMock = vi.fn();

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ status: statusFixture }) }));
vi.mock('./usePwaUpdate', () => ({ usePwaUpdate: () => ({ needsRefresh: needsRefreshFixture, reload: reloadMock }) }));

afterEach(() => {
  reloadMock.mockReset();
  statusFixture = 'signedOut';
  needsRefreshFixture = false;
});

describe('PwaUpdater', () => {
  it('applies a waiting update immediately when nobody is signed in', () => {
    needsRefreshFixture = true;
    render(<PwaUpdater />);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('also applies it on the not-active / unavailable screens', () => {
    needsRefreshFixture = true;
    statusFixture = 'unavailable';
    render(<PwaUpdater />);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('leaves a signed-in member to the AppShell banner', () => {
    needsRefreshFixture = true;
    statusFixture = 'signedIn';
    render(<PwaUpdater />);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('waits while auth state is still resolving', () => {
    needsRefreshFixture = true;
    statusFixture = 'loading';
    render(<PwaUpdater />);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('does nothing when there is no update', () => {
    render(<PwaUpdater />);
    expect(reloadMock).not.toHaveBeenCalled();
  });
});

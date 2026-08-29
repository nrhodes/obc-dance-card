/**
 * Subscription error path (plan Phase 6b task deliverable 1: "a rules
 * denial on a query was silently rendering an empty inbox until this
 * week"). Asserts that when `onSnapshot` reports an error, the provider
 * (a) still resolves `loading` so the screen doesn't spin forever,
 * (b) exposes `{ code }` on `error` instead of silently looking like "no
 * invites", and (c) logs only the code, never any invite data.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { InvitesProvider } from './InvitesProvider';
import { useInvites } from './useInvites';

vi.mock('../firebase', () => ({ db: {} }));

vi.mock('../admin/useEffectiveMember', () => ({
  useEffectiveMember: () => ({ effectiveMemberId: 'member-a', onBehalfOfMemberId: undefined, actingAsName: null }),
}));

vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: (base: unknown) => base,
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  onSnapshot: (
    _q: unknown,
    _onNext: (snap: { docs: never[] }) => void,
    onError: (err: { code: string }) => void,
  ) => {
    onError({ code: 'permission-denied' });
    return () => {};
  },
}));

function Consumer() {
  const { incoming, loading, error } = useInvites();
  return (
    <div>
      <p>loading: {String(loading)}</p>
      <p>error: {error?.code ?? 'none'}</p>
      <p>incoming: {incoming.length}</p>
    </div>
  );
}

describe('InvitesProvider subscription error path', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('surfaces { code } on error, resolves loading, and never logs invite data', () => {
    render(
      <InvitesProvider>
        <Consumer />
      </InvitesProvider>,
    );

    expect(screen.getByText('loading: false')).toBeTruthy();
    expect(screen.getByText('error: permission-denied')).toBeTruthy();
    expect(screen.getByText('incoming: 0')).toBeTruthy();

    // Every subscription_failed log carries only a name + the error code —
    // never a raw error object, invite id, or member id.
    const subscriptionFailedCalls = errorSpy.mock.calls.filter((args) => args[0] === 'subscription_failed');
    expect(subscriptionFailedCalls.length).toBeGreaterThan(0);
    for (const call of subscriptionFailedCalls) {
      expect(call).toEqual(['subscription_failed', expect.any(String), 'permission-denied']);
    }

    errorSpy.mockRestore();
  });
});

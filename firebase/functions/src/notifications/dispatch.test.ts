/**
 * Plain unit test (no emulator) for `FcmPushProvider`'s per-platform split
 * (Phase 7b task deliverable F): `platform: 'ios'` tokens get the usual
 * `notification` + `data` payload; `platform: 'web'` tokens get a
 * **data-only** message (`title`/`body` folded into `data`, no
 * `notification` block, `webpush.headers.Urgency: 'normal'`) — see
 * `docs/web-push.md` for why. `dispatch.emu.test.ts` covers the rest of
 * `dispatchNotification` end-to-end against the emulator (it always runs
 * with `NoopPushProvider`, which never calls FCM at all, so it can't
 * exercise this split — that's what this file is for).
 */
import { describe, expect, it, vi } from 'vitest';
import type { RegisteredDevice } from '@obc/shared';
import type { MulticastMessage } from 'firebase-admin/messaging';

const sendEachForMulticast = vi.fn();
vi.mock('firebase-admin/messaging', () => ({
  getMessaging: () => ({
    sendEachForMulticast: (...args: unknown[]) => sendEachForMulticast(...args),
  }),
}));

const { FcmPushProvider } = await import('./dispatch.js');

function device(token: string, platform: 'ios' | 'web'): RegisteredDevice {
  return { token, platform, lastSeenAt: '2027-01-01T00:00:00.000Z' };
}

function okResponse(count: number) {
  return { responses: Array.from({ length: count }, () => ({ success: true })) };
}

describe('FcmPushProvider', () => {
  it('sends a single notification+data multicast for ios-only devices', async () => {
    sendEachForMulticast.mockReset().mockResolvedValue(okResponse(1));
    const provider = new FcmPushProvider();

    await provider.send({
      memberId: 'm1',
      devices: [device('ios-token', 'ios')],
      title: 'Invite',
      body: 'Alice invited you',
      data: { inviteId: 'inv1' },
    });

    expect(sendEachForMulticast).toHaveBeenCalledTimes(1);
    const message = sendEachForMulticast.mock.calls[0]![0] as MulticastMessage;
    expect(message.tokens).toEqual(['ios-token']);
    expect(message.notification).toEqual({ title: 'Invite', body: 'Alice invited you' });
    expect(message.data).toEqual({ inviteId: 'inv1' });
    expect((message as { webpush?: unknown }).webpush).toBeUndefined();
  });

  it('sends a data-only multicast with Urgency: normal for web-only devices', async () => {
    sendEachForMulticast.mockReset().mockResolvedValue(okResponse(1));
    const provider = new FcmPushProvider();

    await provider.send({
      memberId: 'm1',
      devices: [device('web-token', 'web')],
      title: 'Invite',
      body: 'Alice invited you',
      data: { inviteId: 'inv1' },
    });

    expect(sendEachForMulticast).toHaveBeenCalledTimes(1);
    const message = sendEachForMulticast.mock.calls[0]![0] as MulticastMessage;
    expect(message.tokens).toEqual(['web-token']);
    expect(message.notification).toBeUndefined();
    expect(message.data).toEqual({ inviteId: 'inv1', title: 'Invite', body: 'Alice invited you' });
    expect(message.webpush).toEqual({ headers: { Urgency: 'normal' } });
  });

  it('sends two separate multicasts when both platforms have devices', async () => {
    sendEachForMulticast.mockReset().mockResolvedValue(okResponse(1));
    const provider = new FcmPushProvider();

    await provider.send({
      memberId: 'm1',
      devices: [device('ios-token', 'ios'), device('web-token', 'web')],
      title: 'Invite',
      body: 'Alice invited you',
      data: {},
    });

    expect(sendEachForMulticast).toHaveBeenCalledTimes(2);
    const tokenSets = sendEachForMulticast.mock.calls.map((c) => (c[0] as MulticastMessage).tokens);
    expect(tokenSets).toContainEqual(['ios-token']);
    expect(tokenSets).toContainEqual(['web-token']);
  });

  it('reports only the dead token, per platform group', async () => {
    sendEachForMulticast.mockReset().mockResolvedValueOnce({
      responses: [
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
        { success: true },
      ],
    });
    const provider = new FcmPushProvider();

    const result = await provider.send({
      memberId: 'm1',
      devices: [device('dead-ios', 'ios'), device('alive-ios', 'ios')],
      title: 'T',
      body: 'B',
      data: {},
    });

    expect(result.invalidTokens).toEqual(['dead-ios']);
  });

  it('does nothing when there are no devices', async () => {
    sendEachForMulticast.mockReset();
    const provider = new FcmPushProvider();
    const result = await provider.send({
      memberId: 'm1',
      devices: [],
      title: 'T',
      body: 'B',
      data: {},
    });
    expect(result.invalidTokens).toEqual([]);
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });
});

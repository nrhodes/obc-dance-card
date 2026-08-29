/**
 * Notification fan-out (plan §11 `notify()` / §16 Phase 5). `createNotification`
 * (plan §5.8) always writes the in-app doc; this Firestore trigger reacts to
 * that write and fans out to the other channels the member's
 * `memberPrivate.notificationPrefs` ask for.
 *
 * Idempotent by construction: `channelsSent` records every channel already
 * delivered, and each channel is added to it (via `arrayUnion`, so a retry
 * racing itself can never double-append) only after that channel's send
 * succeeds. A retried invocation re-reads the doc fresh and only attempts
 * whatever is still missing from `channelsSent` — so `onNotificationCreated`
 * running twice for the same document (Cloud Functions gen2's documented
 * at-least-once delivery) never double-sends.
 *
 * The Functions emulator (unlike Firestore + Auth) is not part of the test
 * suite (`npm run test:emu` only starts `firestore,auth`), so this trigger's
 * logic lives in the plain, directly-callable `dispatchNotification` — the
 * same pattern every other trigger-shaped piece of this codebase uses for its
 * `onCall` handlers (`xxxHandler` exported alongside the deployed `onCall`).
 */
import { randomUUID } from 'node:crypto';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { getMessaging, type MulticastMessage } from 'firebase-admin/messaging';
import {
  paths,
  type MemberPrivate,
  type Notification,
  type NotificationChannel,
  type NotificationPrefs,
  type NotificationType,
  type RegisteredDevice,
} from '@obc/shared';
import { db } from '../lib/admin.js';
import { logger } from '../lib/logger.js';
import { SMTP_PASS } from '../lib/secrets.js';
import { EMULATOR_OUTBOX, getEmailProvider, isDeployed } from '../email/provider.js';
import { notificationEmail } from '../email/templates/notification.js';

/**
 * Notification types that always email immediately regardless of the
 * member's digest preference (plan §11 design notes / task brief §A):
 * security notices, admin broadcasts, and on-behalf-of actions are important
 * enough that batching them into the next day's digest would be a bad
 * default.
 */
const ALWAYS_IMMEDIATE_EMAIL_TYPES: readonly NotificationType[] = [
  'security',
  'broadcast',
  'on_behalf_action',
];

/* ----------------------------------- push ---------------------------------- */

export interface PushSendInput {
  memberId: string;
  devices: RegisteredDevice[];
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface PushSendResult {
  /** Tokens FCM reports as permanently dead — prune from `memberPrivate.devices`. */
  invalidTokens: string[];
}

export interface PushProvider {
  send(input: PushSendInput): Promise<PushSendResult>;
}

/** FCM error codes that mean "this token will never work again" (plan §A). */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/**
 * Real push delivery via the Admin SDK's FCM multicast send — used only
 * when deployed.
 *
 * Sends two separate multicasts, one per platform (Phase 7b task
 * deliverable F): `platform: 'ios'` tokens get the usual `notification` +
 * `data` payload (iOS needs the `notification` block to display anything
 * while backgrounded). `platform: 'web'` tokens get a **data-only** message
 * — `title`/`body` folded into `data`, no `notification` block — because
 * some browsers auto-display a pure `notification`-payload web push using
 * the worker's default click action instead of ever invoking
 * `onBackgroundMessage`, bypassing this app's per-notification deep link
 * (see `docs/web-push.md`). `sw.ts`'s `onBackgroundMessage` handler builds
 * the notification itself from `data.title`/`data.body` in that case.
 * `webpush.headers.Urgency: 'normal'` asks browser push services not to
 * silently coalesce/drop it as low-priority, matching how important the
 * `notification`-payload path was already treated.
 */
export class FcmPushProvider implements PushProvider {
  async send({ devices, title, body, data }: PushSendInput): Promise<PushSendResult> {
    if (devices.length === 0) return { invalidTokens: [] };
    const invalidTokens: string[] = [];

    async function sendGroup(
      tokens: string[],
      rest: Omit<MulticastMessage, 'tokens'>,
    ): Promise<void> {
      if (tokens.length === 0) return;
      const response = await getMessaging().sendEachForMulticast({ tokens, ...rest });
      response.responses.forEach((r, i) => {
        if (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code)) {
          invalidTokens.push(tokens[i]!);
        }
      });
    }

    const iosTokens = devices.filter((d) => d.platform === 'ios').map((d) => d.token);
    const webTokens = devices.filter((d) => d.platform === 'web').map((d) => d.token);

    await sendGroup(iosTokens, { notification: { title, body }, data });
    await sendGroup(webTokens, {
      data: { ...data, title, body },
      webpush: { headers: { Urgency: 'normal' } },
    });

    return { invalidTokens };
  }
}

/**
 * There is no FCM in the emulator (or in `vitest`). Outside a deployed
 * function, push "sends" by writing a doc to `emulatorOutbox` so tests and
 * manual testers can assert on it, exactly as the console email provider
 * does for emails.
 */
export class NoopPushProvider implements PushProvider {
  async send({ memberId, title, body }: PushSendInput): Promise<PushSendResult> {
    await db.collection(EMULATOR_OUTBOX).doc(randomUUID()).set({
      kind: 'push',
      to: memberId,
      title,
      body,
      createdAt: new Date().toISOString(),
    });
    return { invalidTokens: [] };
  }
}

function selectPushProvider(override?: PushProvider): PushProvider {
  if (override) return override;
  return isDeployed() ? new FcmPushProvider() : new NoopPushProvider();
}

/* ------------------------------------ sms ----------------------------------- */

export interface SmsSendInput {
  memberId: string;
  phone: string;
  body: string;
}

export interface SmsProvider {
  send(input: SmsSendInput): Promise<void>;
}

/**
 * Plan §11: "SMS: `SmsProvider` interface with a `noop` implementation only."
 * `memberPrivate.notificationPrefs` has no `sms` field yet, so `wantedChannels`
 * below never selects `'sms'` — this exists purely so the channel is a real,
 * swappable seam once a provider is chosen, matching `NOTIFICATION_CHANNELS`.
 */
export class NoopSmsProvider implements SmsProvider {
  async send(): Promise<void> {
    // Intentionally does nothing — no SMS provider is configured (plan §11).
  }
}

/* --------------------------------- dispatch --------------------------------- */

/**
 * Which channels a notification of `type` should be delivered on, given the
 * recipient's prefs and registered devices. Never returns `'inapp'` (already
 * written by `createNotification` before this trigger ever runs) or `'sms'`
 * (no provider yet — see `NoopSmsProvider`). Order matters only for the
 * resulting `channelsSent` array's readability; push is checked before email.
 */
function wantedChannels(
  type: NotificationType,
  prefs: NotificationPrefs,
  devices: RegisteredDevice[],
): NotificationChannel[] {
  const channels: NotificationChannel[] = [];

  if (prefs.push && devices.length > 0) {
    channels.push('push');
  }

  if (prefs.email) {
    const alwaysImmediate = ALWAYS_IMMEDIATE_EMAIL_TYPES.includes(type);
    // Guard even though a session_reminder should never have been created
    // for a member with reminders off (task brief §A) — belt and braces.
    const reminderBlocked = type === 'session_reminder' && !prefs.reminders;
    if (!reminderBlocked && (alwaysImmediate || prefs.digest === 'immediate')) {
      channels.push('email');
    }
    // digest === 'daily' (and not an always-immediate type): left for
    // `sendDailyDigest` (scheduled.ts) to pick up later — nothing to do now.
  }

  return channels;
}

export interface DispatchDeps {
  pushProvider?: PushProvider;
}

/**
 * Fans a single `notifications/{id}` doc out to whichever channels its
 * `channelsSent` is still missing. Safe to call more than once for the same
 * id (see module doc comment). No-ops silently if the notification or the
 * recipient's `memberPrivate` doc has since been deleted.
 */
export async function dispatchNotification(
  notificationId: string,
  deps: DispatchDeps = {},
): Promise<void> {
  const ref = db.doc(paths.notification(notificationId));
  const snap = await ref.get();
  const notification = snap.data() as Notification | undefined;
  if (!notification) return;

  const privateSnap = await db.doc(paths.memberPrivate(notification.memberId)).get();
  const memberPrivate = privateSnap.data() as MemberPrivate | undefined;
  if (!memberPrivate) {
    logger.warn('notification_dispatch_missing_member_private', { type: notification.type });
    return;
  }

  const wanted = wantedChannels(
    notification.type,
    memberPrivate.notificationPrefs,
    memberPrivate.devices,
  );
  const alreadySent = new Set(notification.channelsSent);
  const pending = wanted.filter((channel) => !alreadySent.has(channel));
  if (pending.length === 0) return;

  for (const channel of pending) {
    if (channel === 'push') {
      await sendPush(notification, memberPrivate, deps.pushProvider);
    } else if (channel === 'email') {
      await sendEmailImmediate(notification, memberPrivate);
    }
    // Mark this channel done before moving to the next, so a crash partway
    // through never repeats a channel that already succeeded.
    await ref.update({
      channelsSent: FieldValue.arrayUnion(channel),
      updatedAt: new Date().toISOString(),
    });
    logger.info('notification_dispatched', {
      type: notification.type,
      channel,
      memberId: notification.memberId,
    });
  }
}

async function sendPush(
  notification: Notification,
  memberPrivate: MemberPrivate,
  override?: PushProvider,
): Promise<void> {
  const provider = selectPushProvider(override);
  const result = await provider.send({
    memberId: notification.memberId,
    devices: memberPrivate.devices,
    title: notification.title,
    body: notification.body,
    data: notification.data,
  });

  if (result.invalidTokens.length > 0) {
    const dead = new Set(result.invalidTokens);
    const kept = memberPrivate.devices.filter((d) => !dead.has(d.token));
    await db
      .doc(paths.memberPrivate(notification.memberId))
      .set({ devices: kept, updatedAt: new Date().toISOString() }, { merge: true });
    // Keep the in-memory copy consistent for anything reading it later in
    // this same dispatch call (there isn't currently, but cheap insurance).
    memberPrivate.devices = kept;
  }
}

async function sendEmailImmediate(
  notification: Notification,
  memberPrivate: MemberPrivate,
): Promise<void> {
  const content = notificationEmail(notification.title, notification.body);
  await getEmailProvider().send({
    to: memberPrivate.emailLower,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
}

/* ------------------------------------ trigger -------------------------------- */

export const onNotificationCreated = onDocumentCreated(
  {
    document: 'notifications/{id}',
    region: 'australia-southeast1',
    secrets: [SMTP_PASS],
    retry: true,
  },
  async (event) => {
    if (!event.data) return;
    await dispatchNotification(event.params.id);
  },
);

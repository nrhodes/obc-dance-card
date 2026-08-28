/**
 * Generic immediate-notification email (plan §11 `notify()` fan-out /
 * §16 Phase 5). Used by the `onNotificationCreated` dispatcher for every
 * notification type that emails immediately: the subject is the
 * notification's `title`, the body is its `body` plus a fixed, link-free
 * footer (plan §8.1 "Phishing conditioning" — the same "never a link" rule
 * that governs the login-code email applies to every email the app sends).
 */
import { esc } from './esc.js';

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export const NOTIFICATION_EMAIL_FOOTER =
  'Open the OBC Dance Card app to respond. We never include sign-in links in email.';

export function notificationEmail(title: string, body: string): EmailContent {
  // Email subject headers cannot contain a literal newline; strip any before
  // it reaches the transport, rather than trusting every caller (broadcast
  // titles are free-text admin input) to have done so already.
  const subject = title.replace(/[\r\n]+/g, ' ').trim();

  const text = [body, '', NOTIFICATION_EMAIL_FOOTER].join('\n');

  const html = [`<p>${esc(body)}</p>`, `<p>${esc(NOTIFICATION_EMAIL_FOOTER)}</p>`].join('\n');

  return { subject, text, html };
}

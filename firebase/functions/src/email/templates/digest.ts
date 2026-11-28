/**
 * Daily digest email (plan §9.2 `sendDailyDigest`, §16 Phase 5): one email
 * listing every notification a member accumulated in the last 24h that
 * hasn't already been emailed. Link-free, same footer as the immediate
 * notification template.
 */
import { esc } from './esc.js';
import { NOTIFICATION_EMAIL_FOOTER } from './notification.js';

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export interface DigestItem {
  title: string;
  body: string;
}

/** `brand` as for `loginCodeEmail`: the person's one club, or the product's name. */
export function digestEmail(items: DigestItem[], brand: string): EmailContent {
  const safeBrand = brand.replace(/[\r\n]+/g, ' ');
  const subject =
    items.length === 1
      ? `Your ${safeBrand} update`
      : `Your ${safeBrand} updates (${items.length})`;

  const textItems = items.map((item) => `${item.title}\n${item.body}`).join('\n\n');
  const text = [textItems, '', NOTIFICATION_EMAIL_FOOTER].join('\n');

  const htmlItems = items
    .map((item) => `<li><strong>${esc(item.title)}</strong><br>${esc(item.body)}</li>`)
    .join('\n');
  const html = [`<ul>${htmlItems}</ul>`, `<p>${esc(NOTIFICATION_EMAIL_FOOTER)}</p>`].join('\n');

  return { subject, text, html };
}

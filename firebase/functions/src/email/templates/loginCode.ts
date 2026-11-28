/**
 * Login-code email (plan §8.2, §8.1 "Phishing conditioning"). No links, ever
 * — members must never be trained to click a link in an email from "the
 * club" to sign in. `code` is always 6 ASCII digits, but we still run it
 * through `esc()` to keep the "every interpolated value is escaped" rule
 * exception-free for future templates that copy this one.
 */
import { esc } from './esc.js';

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

/**
 * `brand` is who the code is from: the person's club when they belong to
 * exactly one, otherwise the product's name (`brandNameForClubs`).
 */
export function loginCodeEmail(code: string, brand: string): EmailContent {
  const safeCode = esc(code);

  const subject = `Your ${brand} sign-in code`.replace(/[\r\n]+/g, ' ');

  const text = [
    `Your ${brand} sign-in code is: ${code}`,
    '',
    'This code is valid for 10 minutes.',
    '',
    'We will never ask you to click a link to sign in.',
  ].join('\n');

  const html = [
    `<p>Your ${esc(brand)} sign-in code is:</p>`,
    `<p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${safeCode}</p>`,
    '<p>This code is valid for 10 minutes.</p>',
    '<p>We will never ask you to click a link to sign in.</p>',
  ].join('\n');

  return { subject, text, html };
}

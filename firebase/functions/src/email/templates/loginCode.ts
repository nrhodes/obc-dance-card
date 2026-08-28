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

export function loginCodeEmail(code: string): EmailContent {
  const safeCode = esc(code);

  const subject = 'Your Orewa Bridge Club sign-in code';

  const text = [
    `Your Orewa Bridge Club sign-in code is: ${code}`,
    '',
    'This code is valid for 10 minutes.',
    '',
    'We will never ask you to click a link to sign in.',
  ].join('\n');

  const html = [
    '<p>Your Orewa Bridge Club sign-in code is:</p>',
    `<p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${safeCode}</p>`,
    '<p>This code is valid for 10 minutes.</p>',
    '<p>We will never ask you to click a link to sign in.</p>',
  ].join('\n');

  return { subject, text, html };
}

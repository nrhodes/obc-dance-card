/**
 * Visitor courtesy email (plan §12.4). Opt-in only, sent on confirmation
 * (this template) — cancellation is a Phase 5 concern (see the TODO on
 * `cancelEntry`'s visitor branch). Never contains a link, states who
 * entered the visitor's details, and how to ask for removal.
 */
import { esc } from './esc.js';

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export interface VisitorCourtesyEmailInput {
  sponsorName: string;
  sponsorPhone?: string;
  /** NZ-local `YYYY-MM-DD` dates, already sorted. */
  dates: string[];
  seriesName?: string;
}

/** Club address visitors can write to if they want their details removed. */
const CLUB_CONTACT_EMAIL = process.env.CLUB_CONTACT_EMAIL || 'info@orewabridgeclub.org.nz';

export function visitorCourtesyEmail(input: VisitorCourtesyEmailInput): EmailContent {
  const { sponsorName, sponsorPhone, dates, seriesName } = input;
  const dateList = dates.join(', ');
  const seriesSuffix = seriesName ? ` (${seriesName})` : '';
  const contactLine = sponsorPhone
    ? `Contact ${sponsorName} on ${sponsorPhone} if anything changes.`
    : `Contact ${sponsorName} if anything changes.`;

  const subject = 'You are down to play at Orewa Bridge Club';

  const text = [
    `You are down to play with ${sponsorName} at Orewa Bridge Club on ${dateList}${seriesSuffix}.`,
    contactLine,
    '',
    `${sponsorName} gave us your details to arrange this game. If you would like them removed, ` +
      `email the club at ${CLUB_CONTACT_EMAIL}.`,
  ].join('\n');

  const safeSponsor = esc(sponsorName);
  const safeDates = esc(dateList);
  const safeSeriesSuffix = seriesName ? ` (${esc(seriesName)})` : '';
  const safeContactLine = sponsorPhone
    ? `Contact ${safeSponsor} on ${esc(sponsorPhone)} if anything changes.`
    : `Contact ${safeSponsor} if anything changes.`;
  const safeClubEmail = esc(CLUB_CONTACT_EMAIL);

  const html = [
    `<p>You are down to play with ${safeSponsor} at Orewa Bridge Club on ${safeDates}${safeSeriesSuffix}.</p>`,
    `<p>${safeContactLine}</p>`,
    `<p>${safeSponsor} gave us your details to arrange this game. If you would like them removed, ` +
      `email the club at ${safeClubEmail}.</p>`,
  ].join('\n');

  return { subject, text, html };
}

/**
 * Visitor courtesy emails (plan §12.4). Opt-in only, sent on confirmation
 * (`visitorCourtesyEmail`) and cancellation (`visitorCancelledEmail`). Never
 * contains a link, states who entered the visitor's details, and how to ask
 * for removal.
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

export interface VisitorCancelledEmailInput {
  sponsorName: string;
  sponsorPhone?: string;
  /** NZ-local `YYYY-MM-DD` date of the cancelled session. */
  date: string;
  seriesName?: string;
}

/**
 * Cancellation courtesy email (plan §9.3 "Cancelling `S_A` where partner is a
 * visitor: ... courtesy email to the visitor if opted in", §12.4). Mirrors
 * `visitorCourtesyEmail` but a single session only — `cancelEntry` cancels
 * one entry at a time, never a whole series in one call.
 */
export function visitorCancelledEmail(input: VisitorCancelledEmailInput): EmailContent {
  const { sponsorName, sponsorPhone, date, seriesName } = input;
  const seriesSuffix = seriesName ? ` (${seriesName})` : '';
  const contactLine = sponsorPhone
    ? `Contact ${sponsorName} on ${sponsorPhone} if you have any questions.`
    : `Contact ${sponsorName} if you have any questions.`;

  const subject = 'Your game at Orewa Bridge Club has been cancelled';

  const text = [
    `Your game with ${sponsorName} at Orewa Bridge Club on ${date}${seriesSuffix} has been cancelled.`,
    contactLine,
    '',
    `${sponsorName} gave us your details to arrange this game. If you would like them removed, ` +
      `email the club at ${CLUB_CONTACT_EMAIL}.`,
  ].join('\n');

  const safeSponsor = esc(sponsorName);
  const safeDate = esc(date);
  const safeSeriesSuffix = seriesName ? ` (${esc(seriesName)})` : '';
  const safeContactLine = sponsorPhone
    ? `Contact ${safeSponsor} on ${esc(sponsorPhone)} if you have any questions.`
    : `Contact ${safeSponsor} if you have any questions.`;
  const safeClubEmail = esc(CLUB_CONTACT_EMAIL);

  const html = [
    `<p>Your game with ${safeSponsor} at Orewa Bridge Club on ${safeDate}${safeSeriesSuffix} has been cancelled.</p>`,
    `<p>${safeContactLine}</p>`,
    `<p>${safeSponsor} gave us your details to arrange this game. If you would like them removed, ` +
      `email the club at ${safeClubEmail}.</p>`,
  ].join('\n');

  return { subject, text, html };
}

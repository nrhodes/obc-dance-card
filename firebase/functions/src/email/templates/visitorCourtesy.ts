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
  /** The club the game is at (`Club.name`). */
  clubName: string;
  /** The club's contact address for removal requests, if it has one. */
  contactEmail?: string;
  sponsorName: string;
  sponsorPhone?: string;
  /** NZ-local `YYYY-MM-DD` dates, already sorted. */
  dates: string[];
  seriesName?: string;
}

/**
 * How a visitor gets their details removed: by writing to the club's contact
 * address when it has one (`clubContactEmail`), otherwise through the member
 * who signed them up. `esc` is applied by the caller for the HTML part.
 */
function removalLine(sponsorName: string, contactEmail: string | undefined): string {
  return contactEmail
    ? `${sponsorName} gave us your details to arrange this game. If you would like them removed, email the club at ${contactEmail}.`
    : `${sponsorName} gave us your details to arrange this game. If you would like them removed, ask ${sponsorName} or the club.`;
}

export function visitorCourtesyEmail(input: VisitorCourtesyEmailInput): EmailContent {
  const { clubName, contactEmail, sponsorName, sponsorPhone, dates, seriesName } = input;
  const dateList = dates.join(', ');
  const seriesSuffix = seriesName ? ` (${seriesName})` : '';
  const contactLine = sponsorPhone
    ? `Contact ${sponsorName} on ${sponsorPhone} if anything changes.`
    : `Contact ${sponsorName} if anything changes.`;

  const subject = `You are down to play at ${clubName}`.replace(/[\r\n]+/g, ' ');

  const text = [
    `You are down to play with ${sponsorName} at ${clubName} on ${dateList}${seriesSuffix}.`,
    contactLine,
    '',
    removalLine(sponsorName, contactEmail),
  ].join('\n');

  const safeSponsor = esc(sponsorName);
  const safeDates = esc(dateList);
  const safeSeriesSuffix = seriesName ? ` (${esc(seriesName)})` : '';
  const safeContactLine = sponsorPhone
    ? `Contact ${safeSponsor} on ${esc(sponsorPhone)} if anything changes.`
    : `Contact ${safeSponsor} if anything changes.`;
  const safeClub = esc(clubName);

  const html = [
    `<p>You are down to play with ${safeSponsor} at ${safeClub} on ${safeDates}${safeSeriesSuffix}.</p>`,
    `<p>${safeContactLine}</p>`,
    `<p>${esc(removalLine(sponsorName, contactEmail))}</p>`,
  ].join('\n');

  return { subject, text, html };
}

export interface VisitorCancelledEmailInput {
  /** The club the game is at (`Club.name`). */
  clubName: string;
  /** The club's contact address for removal requests, if it has one. */
  contactEmail?: string;
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
  const { clubName, contactEmail, sponsorName, sponsorPhone, date, seriesName } = input;
  const seriesSuffix = seriesName ? ` (${seriesName})` : '';
  const contactLine = sponsorPhone
    ? `Contact ${sponsorName} on ${sponsorPhone} if you have any questions.`
    : `Contact ${sponsorName} if you have any questions.`;

  const subject = `Your game at ${clubName} has been cancelled`.replace(/[\r\n]+/g, ' ');

  const text = [
    `Your game with ${sponsorName} at ${clubName} on ${date}${seriesSuffix} has been cancelled.`,
    contactLine,
    '',
    removalLine(sponsorName, contactEmail),
  ].join('\n');

  const safeSponsor = esc(sponsorName);
  const safeDate = esc(date);
  const safeSeriesSuffix = seriesName ? ` (${esc(seriesName)})` : '';
  const safeContactLine = sponsorPhone
    ? `Contact ${safeSponsor} on ${esc(sponsorPhone)} if you have any questions.`
    : `Contact ${safeSponsor} if you have any questions.`;
  const safeClub = esc(clubName);

  const html = [
    `<p>Your game with ${safeSponsor} at ${safeClub} on ${safeDate}${safeSeriesSuffix} has been cancelled.</p>`,
    `<p>${safeContactLine}</p>`,
    `<p>${esc(removalLine(sponsorName, contactEmail))}</p>`,
  ].join('\n');

  return { subject, text, html };
}

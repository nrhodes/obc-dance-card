/**
 * Template escaping (plan §8.1 "HTML injection via names", §17 "template
 * escaping (name `<script>` renders escaped)"). Pure unit tests — no
 * emulator needed.
 */
import { describe, expect, it } from 'vitest';
import { digestEmail } from './digest.js';
import { loginCodeEmail } from './loginCode.js';
import { notificationEmail } from './notification.js';
import { visitorCancelledEmail, visitorCourtesyEmail } from './visitorCourtesy.js';

const XSS_NAME = '<script>alert(1)</script>';

function assertNoLinks(content: { text: string; html: string }): void {
  expect(content.text.toLowerCase()).not.toContain('http');
  expect(content.html.toLowerCase()).not.toContain('http');
}

describe('notificationEmail', () => {
  it('escapes the body in html but leaves it verbatim in text', () => {
    const content = notificationEmail('Someone claimed your listing', `${XSS_NAME} will play with you.`);
    expect(content.html).not.toContain(XSS_NAME);
    expect(content.html).toContain('&lt;script&gt;');
    expect(content.text).toContain(XSS_NAME);
    assertNoLinks(content);
  });

  it('strips newlines from the subject', () => {
    const content = notificationEmail('Title\r\nInjected', 'body');
    expect(content.subject).not.toMatch(/[\r\n]/);
  });
});

describe('digestEmail', () => {
  it('escapes every item title/body in html but leaves text verbatim', () => {
    const content = digestEmail([
      { title: `Alert for ${XSS_NAME}`, body: `${XSS_NAME} is looking for a partner.` },
      { title: 'Second', body: 'Second body' },
    ], 'Orewa Bridge Club');
    expect(content.subject).toBe('Your Orewa Bridge Club updates (2)');
    expect(content.html).not.toContain(XSS_NAME);
    expect(content.html).toContain('&lt;script&gt;');
    expect(content.text).toContain(XSS_NAME);
    expect(content.text).toContain('Second body');
    assertNoLinks(content);
  });
});

describe('visitorCourtesyEmail / visitorCancelledEmail', () => {
  it('escapes the sponsor name in html but leaves it verbatim in text', () => {
    const confirm = visitorCourtesyEmail({ clubName: 'Test Club', sponsorName: XSS_NAME, dates: ['2027-06-01'] });
    expect(confirm.html).not.toContain(XSS_NAME);
    expect(confirm.html).toContain('&lt;script&gt;');
    expect(confirm.text).toContain(XSS_NAME);
    assertNoLinks(confirm);

    const cancel = visitorCancelledEmail({ clubName: 'Test Club', sponsorName: XSS_NAME, date: '2027-06-01' });
    expect(cancel.html).not.toContain(XSS_NAME);
    expect(cancel.html).toContain('&lt;script&gt;');
    expect(cancel.text).toContain(XSS_NAME);
    assertNoLinks(cancel);
  });
});

/**
 * A club's name is typed by a platform admin and lands in emails sent to
 * people outside the club, so it is escaped like any other value and no
 * club's name is built into a template (plan §21 B14.8 stage 3).
 */
describe('the club named in an email', () => {
  const CLUB = 'Kaipara <b>Bridge</b> Club';

  it('is the one passed in, escaped in html, for visitor emails', () => {
    const confirm = visitorCourtesyEmail({ clubName: CLUB, sponsorName: 'Ann Lee', dates: ['2027-06-01'] });
    expect(confirm.subject).toBe(`You are down to play at ${CLUB}`);
    expect(confirm.text).toContain(`at ${CLUB} on 2027-06-01`);
    expect(confirm.html).toContain('Kaipara &lt;b&gt;Bridge&lt;/b&gt; Club');
    expect(confirm.html).not.toContain('<b>');
    expect(confirm.text).not.toContain('Orewa');

    const cancel = visitorCancelledEmail({ clubName: CLUB, sponsorName: 'Ann Lee', date: '2027-06-01' });
    expect(cancel.subject).toBe(`Your game at ${CLUB} has been cancelled`);
    expect(cancel.html).not.toContain('<b>');
    expect(cancel.text).not.toContain('Orewa');
  });

  it('tells a visitor where to write when the club has a contact address, and who to ask when it has none', () => {
    const withAddress = visitorCourtesyEmail({
      clubName: 'Test Club',
      contactEmail: 'office@club.example',
      sponsorName: 'Ann Lee',
      dates: ['2027-06-01'],
    });
    expect(withAddress.text).toContain('email the club at office@club.example.');

    const without = visitorCourtesyEmail({ clubName: 'Test Club', sponsorName: 'Ann Lee', dates: ['2027-06-01'] });
    expect(without.text).toContain('ask Ann Lee or the club.');
    expect(without.text).not.toContain('@');
    expect(without.html).not.toContain('@');
  });

  it('is the brand passed in for the sign-in code, escaped in html, with no newline in the subject', () => {
    const content = loginCodeEmail('123456', 'A <i>Club</i>\nX');
    expect(content.subject).toBe('Your A <i>Club</i> X sign-in code');
    expect(content.html).toContain('A &lt;i&gt;Club&lt;/i&gt;');
    expect(content.html).not.toContain('<i>');
    expect(content.text).toContain('123456');
    assertNoLinks(content);
  });
});

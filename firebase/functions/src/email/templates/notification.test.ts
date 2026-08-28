/**
 * Template escaping (plan §8.1 "HTML injection via names", §17 "template
 * escaping (name `<script>` renders escaped)"). Pure unit tests — no
 * emulator needed.
 */
import { describe, expect, it } from 'vitest';
import { digestEmail } from './digest.js';
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
    ]);
    expect(content.html).not.toContain(XSS_NAME);
    expect(content.html).toContain('&lt;script&gt;');
    expect(content.text).toContain(XSS_NAME);
    expect(content.text).toContain('Second body');
    assertNoLinks(content);
  });
});

describe('visitorCourtesyEmail / visitorCancelledEmail', () => {
  it('escapes the sponsor name in html but leaves it verbatim in text', () => {
    const confirm = visitorCourtesyEmail({ sponsorName: XSS_NAME, dates: ['2027-06-01'] });
    expect(confirm.html).not.toContain(XSS_NAME);
    expect(confirm.html).toContain('&lt;script&gt;');
    expect(confirm.text).toContain(XSS_NAME);
    assertNoLinks(confirm);

    const cancel = visitorCancelledEmail({ sponsorName: XSS_NAME, date: '2027-06-01' });
    expect(cancel.html).not.toContain(XSS_NAME);
    expect(cancel.html).toContain('&lt;script&gt;');
    expect(cancel.text).toContain(XSS_NAME);
    assertNoLinks(cancel);
  });
});

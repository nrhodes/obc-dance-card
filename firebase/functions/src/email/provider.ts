/**
 * Email adapter (plan §11). Selected by `EMAIL_PROVIDER`:
 *  - `console` (default, emulator-friendly): logs the recipient's domain only,
 *    and prints the full message to stdout outside production.
 *  - `smtp`: Google Workspace SMTP relay via `nodemailer` (plan §19 "prefer
 *    the Workspace SMTP route").
 *  - `postmark` / `sendgrid`: not implemented yet (plan's stated fallback if
 *    SMTP deliverability is poor) — stubbed to fail loudly rather than
 *    silently drop mail.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/admin.js';
import { logger } from '../lib/logger.js';
import { isDeployed } from '../lib/runtime.js';
import { SMTP_PASS, SMTP_USER } from '../lib/secrets.js';

export { isDeployed };

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailProvider {
  send(msg: EmailMessage): Promise<void>;
  /**
   * Do the expensive part of a send — for SMTP, connect + STARTTLS + AUTH +
   * QUIT — without sending anything. `requestLoginCode` calls this on the
   * unknown/inactive-email path so that path costs the same wall-clock time
   * as the real send on the known path (security review 2026-11-16, M2):
   * without it, a relay round-trip longer than the uniform floor made known
   * addresses answer in "SMTP time" and unknown ones in exactly the floor.
   * Must never throw to the caller's benefit — failures are swallowed and
   * logged by the caller.
   */
  warm(): Promise<void>;
}

/**
 * Local-only mailbox. When not deployed, the console provider also writes each
 * message to `emulatorOutbox/{id}` so the E2E suite and manual testers can read
 * a login code deterministically instead of scraping logs. The collection is
 * unreadable by clients (the rules' catch-all denies it); tests read it through
 * the emulator's owner-bypass REST API. Never written when deployed.
 */
export const EMULATOR_OUTBOX = 'emulatorOutbox';

/** Never log a full email address (plan §3 rule 7) — domain only. */
function emailDomain(address: string): string {
  const at = address.lastIndexOf('@');
  return at === -1 ? '(invalid)' : address.slice(at + 1);
}

class ConsoleEmailProvider implements EmailProvider {
  async warm(): Promise<void> {
    // Nothing to warm: a console "send" costs nothing either.
  }

  async send(msg: EmailMessage): Promise<void> {
    logger.info('email_sent', {
      provider: 'console',
      toDomain: emailDomain(msg.to),
      subjectLength: msg.subject.length,
    });
    if (!isDeployed()) {
      // Local/emulator/test convenience only. Keyed on the absence of the
      // Cloud Run `K_SERVICE` variable (always present on a deployed
      // function), not NODE_ENV, so a misconfigured deploy that leaves
      // EMAIL_PROVIDER=console can never print a login code into Cloud
      // Logging.
      console.log(
        `\n--- email (console provider) ---\nTo: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n---------------------------------\n`,
      );
      await db.collection(EMULATOR_OUTBOX).doc(randomUUID()).set({
        kind: 'email',
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        createdAt: new Date().toISOString(),
      });
    }
  }
}

class SmtpEmailProvider implements EmailProvider {
  private transporter: Transporter | undefined;

  private getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: false,
        requireTLS: true, // STARTTLS is mandatory, never opportunistic
        auth: {
          user: SMTP_USER.value(),
          pass: SMTP_PASS.value(),
        },
      });
    }
    return this.transporter;
  }

  /** The same connection, TLS and AUTH handshake `sendMail` performs, then QUIT — no DATA. */
  async warm(): Promise<void> {
    await this.getTransporter().verify();
  }

  async send(msg: EmailMessage): Promise<void> {
    await this.getTransporter().sendMail({
      from: process.env.EMAIL_FROM,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    logger.info('email_sent', { provider: 'smtp', toDomain: emailDomain(msg.to) });
  }
}

class NotImplementedEmailProvider implements EmailProvider {
  constructor(private readonly name: string) {}

  async warm(): Promise<void> {}

  send(): Promise<void> {
    throw new Error(`Email provider "${this.name}" is not implemented yet.`);
  }
}

export function getEmailProvider(): EmailProvider {
  const provider = process.env.EMAIL_PROVIDER ?? 'console';
  if (provider === 'console' && isDeployed()) {
    // Deployed with no real provider: every login code is silently dropped.
    logger.error('email_provider_console_outside_emulator', {});
  }
  switch (provider) {
    case 'smtp':
      return new SmtpEmailProvider();
    case 'console':
      return new ConsoleEmailProvider();
    case 'postmark':
    case 'sendgrid':
      return new NotImplementedEmailProvider(provider);
    default:
      logger.warn('unknown_email_provider', { provider });
      return new ConsoleEmailProvider();
  }
}

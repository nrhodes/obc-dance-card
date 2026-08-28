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
import { logger } from '../lib/logger.js';
import { SMTP_PASS } from '../lib/secrets.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailProvider {
  send(msg: EmailMessage): Promise<void>;
}

/** True on a deployed Cloud Function (Cloud Run sets `K_SERVICE`); false in the emulator, tests, and local scripts. */
function isDeployed(): boolean {
  return typeof process.env.K_SERVICE === 'string' && process.env.K_SERVICE.length > 0;
}

/** Never log a full email address (plan §3 rule 7) — domain only. */
function emailDomain(address: string): string {
  const at = address.lastIndexOf('@');
  return at === -1 ? '(invalid)' : address.slice(at + 1);
}

class ConsoleEmailProvider implements EmailProvider {
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
          user: process.env.SMTP_USER,
          pass: SMTP_PASS.value(),
        },
      });
    }
    return this.transporter;
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

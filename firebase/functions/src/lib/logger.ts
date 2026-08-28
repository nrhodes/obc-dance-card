/**
 * PII-safe structured logging (plan §3 rule 7 / §8.1 "Logs"). This wrapper's
 * signature only accepts primitive-valued fields — no free-form objects — to
 * make it awkward to accidentally log a login code, a token, an email, or a
 * phone number. Log ids, action names, counts, and error codes instead.
 */
import * as functionsLogger from 'firebase-functions/logger';

export type LogFields = Record<string, string | number | boolean | null>;

function write(level: 'info' | 'warn' | 'error', event: string, fields: LogFields): void {
  functionsLogger[level](event, fields);
}

export const logger = {
  info(event: string, fields: LogFields = {}): void {
    write('info', event, fields);
  },
  warn(event: string, fields: LogFields = {}): void {
    write('warn', event, fields);
  },
  error(event: string, fields: LogFields = {}): void {
    write('error', event, fields);
  },
};

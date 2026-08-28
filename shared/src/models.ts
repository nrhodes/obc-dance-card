/**
 * Firestore document shapes. Collection paths are given in comments; see
 * `docs/data-model.md` for the full picture and `firestore.rules` for who may
 * read/write each one.
 *
 * Convention: every stored document includes its own `id` field mirroring the
 * Firestore document id, so a document carried around in client state is
 * self-describing.
 */

import type {
  AuditAction,
  DigestMode,
  EntryStatus,
  InviteStatus,
  MemberGrade,
  MemberRole,
  NotificationChannel,
  NotificationType,
  ProgrammeStatus,
  ScoringType,
  SeriesFormat,
  SessionKind,
  Weekday,
} from './enums.js';
import type { EmailLower, Id, IsoDate, IsoDateTime, Timestamps, TimeOfDay } from './primitives.js';

/* -------------------------------------------------------------------------- */
/* members/{memberId}                                                        */
/* -------------------------------------------------------------------------- */

export interface NotificationPrefs {
  push: boolean;
  email: boolean;
  /** Pre-session reminder N days ahead (see `reminderDaysBefore`). */
  reminders: boolean;
  /** Opt-in to "someone is looking for a partner" alerts. */
  matchmakingAlerts: boolean;
  /** How email notifications are batched. */
  digest: DigestMode;
  /** Days before a session to send the reminder, when `reminders` is on. */
  reminderDaysBefore: number;
}

export interface RegisteredDevice {
  /** FCM registration token (iOS) or web-push token. */
  token: string;
  platform: 'ios' | 'web';
  label?: string;
  lastSeenAt: IsoDateTime;
}

export interface Member extends Timestamps {
  id: Id;
  firstName: string;
  lastName: string;
  /** Natural key. Always lower-cased. Unique across active + inactive members. */
  emailLower: EmailLower;
  phone: string;
  grade: MemberGrade;
  role: MemberRole;
  /** False once a member leaves the club; row is kept, never hard-deleted. */
  active: boolean;
  devices: RegisteredDevice[];
  notificationPrefs: NotificationPrefs;
  /** Set when this member was created/updated by a CSV import. */
  lastImportId?: Id;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  push: true,
  email: true,
  reminders: true,
  matchmakingAlerts: false,
  digest: 'immediate',
  reminderDaysBefore: 2,
};

/* -------------------------------------------------------------------------- */
/* programmes/{year}                                                         */
/* -------------------------------------------------------------------------- */

export interface Programme extends Timestamps {
  /** Document id is the 4-digit year as a string, e.g. "2027". */
  id: Id;
  year: number;
  status: ProgrammeStatus;
  importedAt?: IsoDateTime;
  publishedAt?: IsoDateTime;
}

/* programmes/{year}/weekdays/{weekday} */
export interface WeekdayProgramme extends Timestamps {
  /** Document id is the `Weekday` value. */
  id: Weekday;
  weekday: Weekday;
  /** Human label, e.g. "Monday Afternoon", "Tuesday (Juniors) Evening". */
  label: string;
  startTime: TimeOfDay;
  /** "Players must be seated by" time. */
  seatedByTime: TimeOfDay;
  partnerStewardMemberId?: Id;
  /** Free text, e.g. "No partner required". */
  notes?: string;
}

/* programmes/{year}/series/{seriesId} */
export interface Series extends Timestamps {
  id: Id;
  weekday: Weekday;
  name: string;
  scoring: ScoringType;
  format: SeriesFormat;
  /** "best N from M" sessions count, when the series uses it. */
  bestOf: { n: number; m: number } | null;
  /** Whether a one-week substitute may be recorded for this series. */
  allowSubstitute: boolean;
  /** Displayed, not enforced, e.g. "Max 1 open player, min 1 junior player". */
  eligibilityNote?: string;
  /** Any other note printed against the series, e.g. "note Jun 01 is holiday bridge". */
  generalNote?: string;
  /** Sort order within the weekday. */
  order: number;
}

/* programmes/{year}/sessions/{sessionId} */
export interface Session extends Timestamps {
  id: Id;
  date: IsoDate;
  weekday: Weekday;
  /** Null for `holidayBridge` / `noBridge` sessions. */
  seriesId: Id | null;
  kind: SessionKind;
  /** e.g. series name, or "Holiday Bridge", "Labour Day", "Waitangi Day". */
  title: string;
  /** `noBridge` sessions are shown but cannot be signed up for. */
  partnerRequired: boolean;

  /** Denormalised for list rendering without a series lookup. */
  seriesName?: string;
  scoring?: ScoringType;
  format?: SeriesFormat;
}

/* -------------------------------------------------------------------------- */
/* entries/{entryId}                                                         */
/* -------------------------------------------------------------------------- */

/**
 * One member's dance-card entry for one session.
 *
 * Bidirectional invariant: a `confirmed` entry always has an exactly-mirrored
 * entry on the partner's card (`memberId`/`partnerMemberId` swapped), sharing the
 * same `pairingId`. All paired mutations are done by Cloud Functions inside a
 * transaction that writes both halves; clients may only touch their own solo
 * entries.
 */
export interface Entry extends Timestamps {
  id: Id;
  sessionId: Id;
  /** Denormalised from the session for range queries (noticeboard, reminders). */
  date: IsoDate;
  seriesId: Id | null;
  memberId: Id;
  /** The other half of the pairing; null while solo. */
  partnerMemberId: Id | null;
  status: EntryStatus;
  /** Links the two halves of a pairing. Null while solo. */
  pairingId: Id | null;

  /** Set on the covered member's entry when a sub stands in for this week. */
  substituteMemberId?: Id | null;
  /** Set on a substitute's own entry, pointing at who they are covering. */
  isSubstituteFor?: Id | null;

  note?: string;
  /** memberId of whoever created the entry (self, or an admin acting on behalf). */
  createdBy: Id;
  /** Set when an admin created/last changed this on behalf of the member. */
  onBehalfBy?: Id;
}

/* -------------------------------------------------------------------------- */
/* invites/{inviteId}                                                        */
/* -------------------------------------------------------------------------- */

export interface Invite extends Timestamps {
  id: Id;
  sessionId: Id;
  date: IsoDate;
  seriesId: Id | null;
  fromMemberId: Id;
  toMemberId: Id;
  status: InviteStatus;
  /** memberId of whoever sent it (self, or an admin acting on behalf). */
  createdBy: Id;
  onBehalfBy?: Id;
  respondedAt?: IsoDateTime;
  /** When a pending invite auto-expires. */
  expiresAt?: IsoDateTime;
  message?: string;
}

/* -------------------------------------------------------------------------- */
/* notifications/{notificationId}                                            */
/* -------------------------------------------------------------------------- */

export interface Notification extends Timestamps {
  id: Id;
  memberId: Id;
  type: NotificationType;
  title: string;
  body: string;
  /** Deep-link payload, e.g. `{ sessionId, inviteId }`. */
  data: Record<string, string>;
  channelsSent: NotificationChannel[];
  read: boolean;
  readAt?: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* auditLog/{entryId}                                                        */
/* -------------------------------------------------------------------------- */

export interface AuditLogEntry {
  id: Id;
  at: IsoDateTime;
  actorMemberId: Id;
  action: AuditAction;
  targetMemberId?: Id;
  /** Firestore path of the affected document, when there is a single one. */
  entityRef?: string;
  before?: unknown;
  after?: unknown;
  /** Free-form extra context, e.g. import counts. */
  detail?: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* emailCodes/{codeId}  — server-only, never read by clients                 */
/* -------------------------------------------------------------------------- */

export interface EmailLoginCode {
  id: Id;
  emailHash: string;
  codeHash: string;
  expiresAt: IsoDateTime;
  attempts: number;
  consumedAt?: IsoDateTime;
  createdAt: IsoDateTime;
}

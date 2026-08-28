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
  InviteKind,
  InviteScope,
  InviteStatus,
  MemberGrade,
  MemberRole,
  NotificationChannel,
  NotificationType,
  PartnerKind,
  ProgrammeStatus,
  ScoringType,
  SeriesFormat,
  SessionKind,
  TeamStatus,
  Weekday,
} from './enums.js';
import type { EmailLower, Id, IsoDate, IsoDateTime, Timestamps, TimeOfDay } from './primitives.js';

/* -------------------------------------------------------------------------- */
/* members/{memberId} — public-to-members profile                           */
/* -------------------------------------------------------------------------- */

/**
 * `memberId` is the Firebase Auth uid. Created only by `importMembers`. No
 * email, no tokens: those live in `MemberPrivate`.
 */
export interface Member extends Timestamps {
  id: Id;
  firstName: string;
  lastName: string;
  phone: string;
  grade: MemberGrade;
  role: MemberRole;
  /** False once a member leaves the club; row is kept, never hard-deleted. */
  active: boolean;
  /** Set when this member was created/updated by a CSV import. */
  lastImportId?: Id;
}

/* -------------------------------------------------------------------------- */
/* memberPrivate/{memberId} — owner + admin only                            */
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

export interface MemberPrivate extends Timestamps {
  id: Id;
  /** Natural key. Always lower-cased. Unique across active + inactive members. */
  emailLower: EmailLower;
  notificationPrefs: NotificationPrefs;
  /** Max 10; oldest/least-recently-seen pruned first. */
  devices: RegisteredDevice[];
  /** Maintained by the server; never trust a client-supplied value. */
  hasPassword: boolean;
  lastLoginAt?: IsoDateTime;
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
/* visitors/{visitorId} — sponsor + admin only                               */
/* -------------------------------------------------------------------------- */

/**
 * A visitor belongs to the member who created it. Other members see only
 * `displayName`, denormalised onto entries (`PartnerRef`) — never this doc.
 */
export interface Visitor extends Timestamps {
  id: Id;
  /** Required, 1..80 chars. */
  displayName: string;
  /** Validated, lowercased, when present. */
  email?: string;
  phone?: string;
  createdByMemberId: Id;
  notes?: string;
  /** Opt-in courtesy emails on confirm/join/disband/cancel. Default false. */
  courtesyEmails: boolean;
  lastUsedAt: IsoDateTime;
  /**
   * Set by `importMembers` (§12.5) when a new member's email matches this
   * visitor's and the visitor still has a future non-cancelled entry (so the
   * doc is kept, rather than deleted, to keep denormalising `displayName`).
   */
  promotedToMemberId?: Id;
}

/* -------------------------------------------------------------------------- */
/* Partner references (denormalised onto entries)                           */
/* -------------------------------------------------------------------------- */

export type PartnerRef =
  | { kind: Extract<PartnerKind, 'member'>; memberId: Id; displayName: string }
  | { kind: Extract<PartnerKind, 'visitor'>; visitorId: Id; displayName: string };

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
  /** Every session id generated for this series, in date order. */
  sessionIds: Id[];
  /** Teams format only. Defaults 4/6. */
  teamMin: number;
  teamMax: number;
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
/* entries/{sessionId}_{memberId}                                            */
/* -------------------------------------------------------------------------- */

/**
 * One member's dance-card entry for one session. The document id is
 * deterministic (`${sessionId}_${memberId}`): there can only ever be one entry
 * per member per session. Re-signing-up after a cancel updates the same doc.
 *
 * See plan §5.6 / §7 for the full invariants; `shared/src/pairing.ts` checks
 * them programmatically.
 */
export interface Entry extends Timestamps {
  id: Id;
  sessionId: Id;
  /** Denormalised from the session for range queries (noticeboard, reminders). */
  date: IsoDate;
  weekday: Weekday;
  seriesId: Id | null;
  memberId: Id;
  status: EntryStatus;
  /** The other half of a member/visitor pairing; null while solo or on a team. */
  partner: PartnerRef | null;
  /** Shared by all entries of one pairing. Null for team entries and solo statuses. */
  pairingId: Id | null;
  /** Set for every entry that belongs to a team (Teams series). */
  teamId: Id | null;
  /** True for a session-only team substitute added by the captain. */
  teamSessionOnly: boolean;
  /** On the *covered* member's entry: who stands in this week. */
  substitute: PartnerRef | null;
  /** On the *remaining* member's entry: who their partner sent as a sub. */
  partnerSubstitute: PartnerRef | null;
  /** On a member-substitute's own entry: the memberId they are covering for. */
  isSubstituteFor: Id | null;

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
  scope: InviteScope;
  /**
   * Set only for `scope: 'team'`. Absent (and every non-team invite) means
   * `'join'`. `'captaincy'` is `transferCaptaincy`'s offer to the new
   * captain — plan §9.2.
   */
  kind?: InviteKind;
  /**
   * Programme year the sessions belong to. Threaded through so later
   * lookups (respond/cancel) never have to re-derive it from a session id
   * shape (plan §5.4's two id forms aren't reliably splittable).
   */
  year: number;
  /** 1..N session ids this invite covers. */
  sessionIds: Id[];
  seriesId: Id | null;
  /** Set only for `scope: 'team'`. */
  teamId: Id | null;
  /** The captain, for team invites. */
  fromMemberId: Id;
  toMemberId: Id;
  status: InviteStatus;
  /** memberId of whoever sent it (self, or an admin acting on behalf). */
  createdBy: Id;
  onBehalfBy?: Id;
  respondedAt?: IsoDateTime;
  /** ISO instant; 7 days out or the first session's date, whichever is earlier. */
  expiresAt: IsoDateTime;
  /** <= 200 chars. */
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
/* teams/{teamId} — one team, for one Teams-format series                   */
/* -------------------------------------------------------------------------- */

export interface TeamMemberEntry {
  ref: PartnerRef;
  joinedAt: IsoDateTime;
}

/**
 * `teamId` is deterministic: `${seriesId}-${captainMemberId}` at creation (a
 * captain has at most one team per series). Readable by all active members;
 * writable only by callables.
 */
export interface Team extends Timestamps {
  id: Id;
  year: number;
  seriesId: Id;
  /** Default "<Captain surname> team". */
  name: string;
  captainMemberId: Id;
  /** Includes the captain; members or visitors. */
  members: TeamMemberEntry[];
  status: TeamStatus;
  /**
   * Session-only substitutes who are visitors (plan §9.2
   * `addTeamSessionSubstitute`): keyed by `sessionId`, since a visitor sub
   * has no `entries` doc of its own to record it on. A member sub is
   * recorded as a `teamSessionOnly` entry instead (I9) and never appears
   * here. Additive field — absent means "none recorded".
   */
  sessionVisitors?: Record<Id, PartnerRef[]>;
}

/* -------------------------------------------------------------------------- */
/* auditLog/{entryId} — server-only, never client-readable/writable          */
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
/* emailCodes/{emailHash} — server-only, never read by clients               */
/* -------------------------------------------------------------------------- */

/** Document id is `sha256(emailLower)`. */
export interface EmailLoginCode {
  id: Id;
  /** HMAC-SHA256(pepper, email + ':' + code). */
  codeHmac: string;
  expiresAt: IsoDateTime;
  attempts: number;
  consumedAt?: IsoDateTime;
  createdAt: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* rateLimits/{bucket}:{sha256(subject)} — server-only                       */
/* -------------------------------------------------------------------------- */

export interface RateLimit {
  id: Id;
  windowStart: IsoDateTime;
  count: number;
}

/* -------------------------------------------------------------------------- */
/* imports/{importId} — server-only                                          */
/* -------------------------------------------------------------------------- */

export interface ImportRecord {
  id: Id;
  kind: 'members' | 'programme';
  actorMemberId: Id;
  startedAt: IsoDateTime;
  finishedAt?: IsoDateTime;
  report?: unknown;
}

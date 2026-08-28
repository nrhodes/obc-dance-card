/**
 * Closed vocabularies used across the data model. Each is declared once as a
 * `const` tuple so it can drive both a union type and runtime validation.
 */

export const MEMBER_GRADES = ['Open', 'Intermediate', 'Junior', 'Unknown'] as const;
export type MemberGrade = (typeof MEMBER_GRADES)[number];

export const MEMBER_ROLES = ['member', 'admin'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/** Day a weekday programme runs on. Tuesday is the juniors' evening. */
export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const SCORING_TYPES = ['Scr', 'Hcp'] as const;
export type ScoringType = (typeof SCORING_TYPES)[number];

export const SERIES_FORMATS = ['Pairs', 'Teams', 'Individual'] as const;
export type SeriesFormat = (typeof SERIES_FORMATS)[number];

/** What a single dated session is. */
export const SESSION_KINDS = ['series', 'holidayBridge', 'noBridge'] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

/**
 * State of one member's entry for one session.
 * - `confirmed`         paired; a mirror entry exists on the partner's card
 * - `pending_partner`   an invite has gone out but not yet been accepted
 * - `looking_for_partner` publicly asking for a partner for this session
 * - `available`         publicly marked free to play this session
 * - `cancelled`         withdrawn; kept for history, not shown as active
 */
export const ENTRY_STATUSES = [
  'confirmed',
  'pending_partner',
  'looking_for_partner',
  'available',
  'cancelled',
] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

/** Statuses that occupy a member for a session (block a second active entry). */
export const ACTIVE_ENTRY_STATUSES = [
  'confirmed',
  'pending_partner',
  'looking_for_partner',
  'available',
] as const satisfies readonly EntryStatus[];

/** Statuses visible on the public noticeboard. */
export const NOTICEBOARD_STATUSES = [
  'looking_for_partner',
  'available',
] as const satisfies readonly EntryStatus[];

export const INVITE_STATUSES = [
  'pending',
  'accepted',
  'declined',
  'cancelled',
  'expired',
] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export const PROGRAMME_STATUSES = ['draft', 'published'] as const;
export type ProgrammeStatus = (typeof PROGRAMME_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ['push', 'email', 'sms'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_TYPES = [
  'invite_received',
  'invite_accepted',
  'invite_declined',
  'invite_cancelled',
  'partner_cancelled',
  'substitute_arranged',
  'substitute_request',
  'matchmaking_alert',
  'session_reminder',
  'broadcast',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const DIGEST_MODES = ['immediate', 'daily'] as const;
export type DigestMode = (typeof DIGEST_MODES)[number];

/** Actions recorded in the audit log (admin on-behalf and system repairs). */
export const AUDIT_ACTIONS = [
  'member_import',
  'programme_import',
  'programme_publish',
  'entry_create_on_behalf',
  'entry_cancel_on_behalf',
  'invite_send_on_behalf',
  'invite_respond_on_behalf',
  'substitute_set_on_behalf',
  'pairing_repair',
  'broadcast_sent',
  'role_changed',
  'member_deactivated',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Runtime membership test for any of the const tuples above. */
export function isOneOf<T extends readonly string[]>(
  vocab: T,
  value: unknown,
): value is T[number] {
  return typeof value === 'string' && (vocab as readonly string[]).includes(value);
}

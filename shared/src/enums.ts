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

/** Whether a partner reference points at a member or a non-member visitor. */
export const PARTNER_KINDS = ['member', 'visitor'] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];

/**
 * State of one member's entry for one session.
 * - `confirmed`            paired (member or visitor), or a member of a team
 * - `looking_for_partner`  public, first-claim-wins
 * - `available`            public, a claim sends an invite
 * - `substituted`          paired, but covered this session by a substitute
 * - `cancelled`            withdrawn; kept for history, treated as absent
 */
export const ENTRY_STATUSES = [
  'confirmed',
  'looking_for_partner',
  'available',
  'substituted',
  'cancelled',
] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

/** Statuses that occupy a member for a session (block a second active entry). */
export const ACTIVE_ENTRY_STATUSES = [
  'confirmed',
  'looking_for_partner',
  'available',
  'substituted',
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

/** What an invite covers: a single session, a whole series sign-up, or a team invite. */
export const INVITE_SCOPES = ['session', 'series', 'team'] as const;
export type InviteScope = (typeof INVITE_SCOPES)[number];

export const PROGRAMME_STATUSES = ['draft', 'published'] as const;
export type ProgrammeStatus = (typeof PROGRAMME_STATUSES)[number];

export const TEAM_STATUSES = ['forming', 'active', 'disbanded'] as const;
export type TeamStatus = (typeof TEAM_STATUSES)[number];

/**
 * What a `scope:'team'` invite is for: joining the roster (`'join'`, the
 * default when the field is absent — every invite created before this kind
 * existed is implicitly a join invite) or accepting the captaincy
 * (`'captaincy'`, plan §9.2 `transferCaptaincy`).
 */
export const INVITE_KINDS = ['join', 'captaincy'] as const;
export type InviteKind = (typeof INVITE_KINDS)[number];

export const NOTIFICATION_CHANNELS = ['inapp', 'push', 'email', 'sms'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_TYPES = [
  'invite_received',
  'invite_accepted',
  'invite_declined',
  'invite_cancelled',
  'invite_expired',
  'claimed',
  'partner_cancelled',
  'substitute_arranged',
  'substitute_cleared',
  'matchmaking_alert',
  'session_reminder',
  'on_behalf_action',
  'team_invite_received',
  'team_member_joined',
  'team_member_declined',
  'team_member_left',
  'team_member_absent',
  'team_removed',
  'team_captaincy_offered',
  'team_captaincy_transferred',
  'team_disbanded',
  'broadcast',
  'security',
  /** §12.5: a visitor's email now matches a newly-imported member. */
  'visitor_promoted',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const DIGEST_MODES = ['immediate', 'daily'] as const;
export type DigestMode = (typeof DIGEST_MODES)[number];

/**
 * Actions recorded in the audit log: admin-initiated system actions, plus one
 * `<callable>_on_behalf` action per callable that supports `onBehalfOfMemberId`
 * (§9.2), logged whenever it is actually used on someone else's behalf.
 */
export const AUDIT_ACTIONS = [
  // System / admin actions
  'member_import',
  'role_changed',
  'member_deactivated',
  'member_reactivated',
  'member_erased',
  'programme_import',
  'programme_publish',
  'programme_edit',
  'broadcast_sent',
  'pairing_repair',
  /** System action: `importMembers` promoted a visitor whose email matched a new member (§12.5). */
  'visitor_promoted',
  // Per-callable on-behalf actions (§9.2 "Audit" column)
  'send_invite_on_behalf',
  'respond_to_invite_on_behalf',
  'cancel_invite_on_behalf',
  'set_solo_status_on_behalf',
  'claim_looking_for_partner_on_behalf',
  'create_visitor_on_behalf',
  'sign_up_with_visitor_on_behalf',
  'set_substitute_on_behalf',
  'clear_substitute_on_behalf',
  'cancel_entry_on_behalf',
  'create_team_on_behalf',
  'invite_to_team_on_behalf',
  'add_visitor_to_team_on_behalf',
  'remove_visitor_from_team_on_behalf',
  'leave_team_on_behalf',
  'remove_from_team_on_behalf',
  'transfer_captaincy_on_behalf',
  'disband_team_on_behalf',
  'add_team_session_substitute_on_behalf',
  'clear_team_session_substitute_on_behalf',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Runtime membership test for any of the const tuples above. */
export function isOneOf<T extends readonly string[]>(
  vocab: T,
  value: unknown,
): value is T[number] {
  return typeof value === 'string' && (vocab as readonly string[]).includes(value);
}

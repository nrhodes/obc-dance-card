/**
 * Contracts for the callable Cloud Functions. Names here match the deployed
 * callable names. Every privileged mutation (anything touching another member's
 * card, imports, on-behalf actions, auth codes) goes through one of these.
 */

import type { MemberImportReport, ProgrammeImportReport } from './csv.js';
import type { EntryStatus, Weekday } from './enums.js';
import type { Entry, Invite, Member, Notification } from './models.js';
import type { Id, IsoDate } from './primitives.js';

/* ----------------------------- auth: email code --------------------------- */

export interface RequestLoginCodeInput {
  email: string;
}
/** Always resolves the same way, whether or not the email is a known member. */
export interface RequestLoginCodeResult {
  ok: true;
}

export interface VerifyLoginCodeInput {
  email: string;
  code: string;
}
export interface VerifyLoginCodeResult {
  /** Firebase custom token for `signInWithCustomToken`. */
  token: string;
}

/* ------------------------------- invites -------------------------------- */

export interface SendInviteInput {
  sessionId: Id;
  toMemberId: Id;
  message?: string;
  /** Admin only: send as this member instead of the caller. */
  onBehalfOfMemberId?: Id;
}
export interface SendInviteResult {
  invite: Invite;
}

export interface RespondToInviteInput {
  inviteId: Id;
  accept: boolean;
  /** Admin only: respond as the invited member. */
  onBehalfOfMemberId?: Id;
}
export interface RespondToInviteResult {
  invite: Invite;
  /** Both mirrored entries when accepted; empty when declined. */
  entries: Entry[];
}

export interface CancelInviteInput {
  inviteId: Id;
  onBehalfOfMemberId?: Id;
}

/* -------------------------------- entries ------------------------------- */

/** Create/replace the caller's own solo entry (looking_for_partner | available). */
export interface SetSoloStatusInput {
  sessionId: Id;
  status: Extract<EntryStatus, 'looking_for_partner' | 'available'>;
  note?: string;
  onBehalfOfMemberId?: Id;
}
export interface SetSoloStatusResult {
  entry: Entry;
}

export interface CancelEntryInput {
  entryId: Id;
  onBehalfOfMemberId?: Id;
}
export interface CancelEntryResult {
  /** The caller's now-cancelled entry. */
  entry: Entry;
  /** The former partner's entry, flipped back to looking_for_partner, if any. */
  partnerEntry?: Entry;
}

/** Directly pair two members (from the noticeboard, or admin matchmaking). */
export interface CreatePairingInput {
  sessionId: Id;
  /** Omit to pair the caller with `partnerMemberId`. */
  memberId?: Id;
  partnerMemberId: Id;
  onBehalfOfMemberId?: Id;
}
export interface CreatePairingResult {
  entries: [Entry, Entry];
  /** True when the pairing repeats a partner in an Individual series. */
  repeatPartnerWarning: boolean;
}

export interface SetSubstituteInput {
  /** The confirmed entry whose partner needs covering this week. */
  entryId: Id;
  substituteMemberId: Id;
  onBehalfOfMemberId?: Id;
}
export interface SetSubstituteResult {
  entries: Entry[];
}

/* --------------------------- admin: imports --------------------------- */

export interface ImportMembersInput {
  /** Raw CSV text. */
  csv: string;
  /** When true, validate and report only; write nothing. */
  dryRun?: boolean;
}
export type ImportMembersResult = MemberImportReport;

export interface ImportProgrammeInput {
  year: number;
  weekdaysCsv: string;
  seriesCsv: string;
  singlesCsv: string;
  dryRun?: boolean;
}
export type ImportProgrammeResult = ProgrammeImportReport;

export interface PublishProgrammeInput {
  year: number;
}
export interface PublishProgrammeResult {
  year: number;
  publishedAt: string;
}

/* --------------------------- admin: misc --------------------------- */

export interface BroadcastInput {
  title: string;
  body: string;
  /** Restrict to members with these weekdays in their upcoming card; empty = all. */
  weekdays?: Weekday[];
}
export interface BroadcastResult {
  recipients: number;
}

export interface SetMemberRoleInput {
  memberId: Id;
  role: Member['role'];
}

/* --------------------------- read helpers --------------------------- */

/** Roster for one session: who is playing, and who is looking. */
export interface SessionRoster {
  sessionId: Id;
  date: IsoDate;
  confirmed: Array<{ pairingId: Id; members: [Member, Member]; substituteFor?: Id }>;
  lookingForPartner: Member[];
  available: Member[];
}

export interface NoticeboardItem {
  entry: Entry;
  member: Member;
  session: { id: Id; date: IsoDate; weekday: Weekday; title: string };
}

export interface MarkNotificationsReadInput {
  notificationIds: Id[];
}

export type { Notification };

/**
 * Contracts for the callable Cloud Functions (plan §9.2). Names here match the
 * deployed callable names. Every privileged mutation (anything touching
 * another member's card, imports, on-behalf actions, auth codes) goes through
 * one of these.
 *
 * Input types are derived from the zod schemas in `schemas.ts` (the parser and
 * the type can never drift apart); result types are hand-written interfaces.
 */

import type { MemberImportReport, ProgrammeImportReport } from './csv.js';
import type { Weekday } from './enums.js';
import type { Entry, Invite, Member, Notification, Team, Visitor } from './models.js';
import type { Id, IsoDate } from './primitives.js';

export type {
  AddTeamSessionSubstituteInput,
  AddVisitorToTeamInput,
  BroadcastInput,
  CancelEntryInput,
  CancelInviteInput,
  ClaimLookingForPartnerInput,
  ClearSubstituteInput,
  ClearTeamSessionSubstituteInput,
  CreateTeamInput,
  CreateVisitorInput,
  DeactivateMemberInput,
  DeleteVisitorInput,
  DisbandTeamInput,
  EraseMemberInput,
  ImportMembersInput,
  ImportProgrammeInput,
  InviteToTeamInput,
  LeaveTeamInput,
  MarkNotificationsReadInput,
  MarkPasswordSetInput,
  PingInput,
  PublishProgrammeInput,
  ReactivateMemberInput,
  RegisterDeviceInput,
  RemoveFromTeamInput,
  RemovePasswordInput,
  RemoveVisitorFromTeamInput,
  RequestLoginCodeInput,
  RespondToInviteInput,
  RunPairingSweepInput,
  SendInviteInput,
  SetMemberRoleInput,
  SetSoloStatusInput,
  SetSubstituteInput,
  SignUpWithVisitorInput,
  TransferCaptaincyInput,
  UnregisterDeviceInput,
  UpdateMyContactInput,
  UpdateMyPrefsInput,
  UpdateSeriesInput,
  UpdateSessionInput,
  UpdateVisitorInput,
  VerifyLoginCodeInput,
} from './schemas.js';

/* ----------------------------- auth: email code --------------------------- */

/** Always resolves the same way, whether or not the email is a known member. */
export interface RequestLoginCodeResult {
  ok: true;
}

export interface VerifyLoginCodeResult {
  /** Firebase custom token for `signInWithCustomToken`. */
  token: string;
}

/* ------------------------------- invites -------------------------------- */

export interface SendInviteResult {
  invite: Invite;
}

export interface RespondToInviteResult {
  invite: Invite;
  /** The mirrored entries created on accept (both members, every session); empty when declined. */
  entries: Entry[];
  /** Set when accepting a team invite that brought the team from `forming` to `active`. */
  team?: Team;
}

/* -------------------------------- entries ------------------------------- */

export interface SetSoloStatusResult {
  entry: Entry;
}

export interface ClaimLookingForPartnerResult {
  entries: Entry[];
  team?: Team;
}

export interface SignUpWithVisitorResult {
  entries: Entry[];
}

export interface SetSubstituteResult {
  entries: Entry[];
}

export interface CancelEntryResult {
  /** The caller's now-cancelled entry. */
  entry: Entry;
  /** The former partner's entry, flipped back to looking_for_partner, if any. */
  partnerEntry?: Entry;
}

/* -------------------------------- visitors ------------------------------- */

export interface CreateVisitorResult {
  visitor: Visitor;
}
export interface UpdateVisitorResult {
  visitor: Visitor;
}

/* ---------------------------------- teams --------------------------------- */

export interface CreateTeamResult {
  team: Team;
  entries: Entry[];
}
export interface DisbandTeamResult {
  team: Team;
}
export interface TransferCaptaincyResult {
  invite: Invite;
}
export interface AddTeamSessionSubstituteResult {
  entry?: Entry;
  team: Team;
}

/* --------------------------- admin: imports --------------------------- */

export type ImportMembersResult = MemberImportReport;

export type ImportProgrammeResult = ProgrammeImportReport;

export interface PublishProgrammeResult {
  year: number;
  publishedAt: string;
}

/* --------------------------- admin: misc --------------------------- */

export interface BroadcastResult {
  recipients: number;
}

/* --------------------------- read helpers --------------------------- */

/** Roster for one session: who is playing, and who is looking. */
export interface SessionRoster {
  sessionId: Id;
  date: IsoDate;
  confirmed: Array<{ pairingId: Id; members: [Member, Member]; substituteFor?: Id }>;
  teams: Team[];
  lookingForPartner: Member[];
  available: Member[];
}

export interface NoticeboardItem {
  entry: Entry;
  member: Member;
  session: { id: Id; date: IsoDate; weekday: Weekday; title: string };
}

export type { Notification };

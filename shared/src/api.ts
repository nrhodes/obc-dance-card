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
import type { AuditLogEntry, Entry, IntegrityViolation, Invite, Member, Notification, Series, Session, Team, Visitor } from './models.js';
import type { Id, IsoDate } from './primitives.js';

export type {
  AddTeamSessionSubstituteInput,
  AddVisitorToTeamInput,
  BroadcastInput,
  BulkSoloStatusFilter,
  CancelEntryInput,
  CancelInviteInput,
  ClaimLookingForPartnerInput,
  ClearSoloStatusInput,
  ClearSubstituteInput,
  ClearTeamSessionSubstituteInput,
  CreateIcalFeedInput,
  CreateTeamInput,
  CreateVisitorInput,
  DeactivateMemberInput,
  DeleteVisitorInput,
  DisbandTeamInput,
  EraseMemberInput,
  GetIcalFeedInput,
  ImportMembersInput,
  ImportProgrammeInput,
  InviteToTeamInput,
  LeaveTeamInput,
  ListAuditLogInput,
  MarkNotificationsReadInput,
  MarkPasswordSetInput,
  SetPasswordInput,
  PingInput,
  PublishProgrammeInput,
  ReactivateMemberInput,
  RegisterDeviceInput,
  RemoveFromTeamInput,
  RemoveIcalFeedInput,
  RemovePasswordInput,
  RemoveVisitorFromTeamInput,
  RequestLoginCodeInput,
  RespondToInviteInput,
  RotateIcalFeedInput,
  RunPairingSweepInput,
  SendInviteInput,
  SetBulkSoloStatusInput,
  SetMemberRoleInput,
  SetSoloStatusInput,
  SetSubstituteInput,
  SignUpWithVisitorInput,
  TransferCaptaincyInput,
  UnregisterDeviceInput,
  UpdateMyContactInput,
  UpdateMyPrefsInput,
  UpdateSeriesInput,
  UpdateSeriesPatch,
  UpdateSessionInput,
  UpdateSessionPatch,
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

/* ------------------------------- ical feed (plan §21 B1) ----------------- */

export interface IcalFeedInfo {
  /** `https://…/ical/{token}.ics` */
  url: string;
  /** Same URL with scheme `webcal:`, for "Open in Apple Calendar". */
  webcalUrl: string;
  createdAt: string;
}

/** `{ url: null }` when the member has never created a feed. */
export type GetIcalFeedResult = IcalFeedInfo | { url: null };

export interface CreateIcalFeedResult {
  url: string;
  webcalUrl: string;
}

export interface RotateIcalFeedResult {
  url: string;
  webcalUrl: string;
}

export interface RemoveIcalFeedResult {
  ok: true;
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
  /** True when accepting pairs the same two members again within an Individual series (plan §2). Never blocks. */
  repeatPartnerWarning?: boolean;
}

export interface CancelInviteResult {
  invite: Invite;
}

/* -------------------------------- entries ------------------------------- */

export interface SetSoloStatusResult {
  entry: Entry;
}

export interface ClearSoloStatusResult {
  entry: Entry;
}

export interface BulkSoloStatusSkip {
  sessionId: Id;
  date: IsoDate;
  /** Why this session was left untouched. Only `'booked'` today — a real pairing/team commitment is never overwritten. */
  reason: 'booked';
}

export interface SetBulkSoloStatusResult {
  /** Entries created/changed (upserted to `available`/`unavailable`, or flipped to `cancelled` by `'clear'`). */
  updated: number;
  skipped: BulkSoloStatusSkip[];
}

export interface ClaimLookingForPartnerResult {
  entries: Entry[];
  team?: Team;
  /** True when this pairs the same two members again within an Individual series (plan §2). Never blocks. */
  repeatPartnerWarning?: boolean;
}

export interface SignUpWithVisitorResult {
  entries: Entry[];
}

export interface SetSubstituteResult {
  entries: Entry[];
}

export interface ClearSubstituteResult {
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
  /** Plan §12.6: a non-blocking warning, e.g. a display-name collision with an active member. */
  warnings: string[];
}
export interface UpdateVisitorResult {
  visitor: Visitor;
}
export interface DeleteVisitorResult {
  ok: true;
}

/* ---------------------------------- teams --------------------------------- */

export interface CreateTeamResult {
  team: Team;
  entries: Entry[];
}
export interface InviteToTeamResult {
  invite: Invite;
}
export interface AddVisitorToTeamResult {
  team: Team;
}
export interface RemoveVisitorFromTeamResult {
  team: Team;
}
export interface LeaveTeamResult {
  team: Team;
}
export interface RemoveFromTeamResult {
  team: Team;
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
export interface ClearTeamSessionSubstituteResult {
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

export interface ListAuditLogResult {
  entries: AuditLogEntry[];
  /** Pass as `before` to fetch the next page; absent when this is the last page. */
  nextBefore?: string;
}

/* --------------------------- admin: members --------------------------- */

export interface SetMemberRoleResult {
  member: Member;
}

export interface DeactivateMemberResult {
  member: Member;
  cancelledEntries: number;
  expiredInvites: number;
}

export interface ReactivateMemberResult {
  member: Member;
}

export interface EraseMemberResult {
  ok: true;
}

/* --------------------------- admin: programme edits --------------------------- */

export interface UpdateSeriesResult {
  series: Series;
}

export interface UpdateSessionResult {
  session: Session | null;
  removed: boolean;
}

/* --------------------------- integrity --------------------------- */

export interface RunPairingSweepResult {
  checkedSessions: number;
  checkedTeams: number;
  violations: IntegrityViolation[];
  repaired: number;
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

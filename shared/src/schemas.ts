/**
 * Zod input schemas for every callable Cloud Function (plan §9.2) and for the
 * four CSV row shapes (plan §13). `firebase/functions` parses every callable's
 * `req.data` with the matching schema before touching auth or Firestore.
 * Result types stay hand-written interfaces in `api.ts`; input types here are
 * derived with `z.infer` and re-exported from `api.ts`.
 */

import { z } from 'zod';
import { MEMBER_ROLES, WEEKDAYS } from './enums.js';

/* ------------------------------- primitives ------------------------------ */

const id = z.string().trim().min(1).max(200);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const email = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(320);
const phone = z.string().trim().max(40);
const message200 = z.string().trim().max(200);
const displayName = z.string().trim().min(1).max(80);
const weekday = z.enum(WEEKDAYS);
const onBehalfOfMemberId = id.optional();
const year = z.number().int().min(2000).max(2100);
/** Admin-only override of a locked session's cutoff (plan §6); enforced server-side. */
const force = z.boolean().optional();

const partnerRefInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('member'), memberId: id }),
  z.object({ kind: z.literal('visitor'), visitorId: id }),
]);

/* -------------------------- auth: email code / password ------------------ */

export const RequestLoginCodeInputSchema = z.object({ email });
export type RequestLoginCodeInput = z.infer<typeof RequestLoginCodeInputSchema>;

export const VerifyLoginCodeInputSchema = z.object({
  email,
  code: z.string().regex(/^\d{6}$/, 'expected a 6-digit code'),
});
export type VerifyLoginCodeInput = z.infer<typeof VerifyLoginCodeInputSchema>;

export const MarkPasswordSetInputSchema = z.object({}).strict();
export type MarkPasswordSetInput = z.infer<typeof MarkPasswordSetInputSchema>;

export const RemovePasswordInputSchema = z.object({}).strict();
export type RemovePasswordInput = z.infer<typeof RemovePasswordInputSchema>;

/* --------------------------------- profile -------------------------------- */

export const UpdateMyContactInputSchema = z.object({ phone: phone.optional() });
export type UpdateMyContactInput = z.infer<typeof UpdateMyContactInputSchema>;

export const NotificationPrefsInputSchema = z.object({
  push: z.boolean(),
  email: z.boolean(),
  reminders: z.boolean(),
  matchmakingAlerts: z.boolean(),
  digest: z.enum(['immediate', 'daily']),
  reminderDaysBefore: z.number().int().min(0).max(7),
});
export const UpdateMyPrefsInputSchema = NotificationPrefsInputSchema;
export type UpdateMyPrefsInput = z.infer<typeof UpdateMyPrefsInputSchema>;

export const RegisterDeviceInputSchema = z.object({
  token: z.string().trim().min(1).max(4096),
  platform: z.enum(['ios', 'web']),
  label: z.string().trim().max(80).optional(),
});
export type RegisterDeviceInput = z.infer<typeof RegisterDeviceInputSchema>;

export const UnregisterDeviceInputSchema = z.object({ token: z.string().trim().min(1).max(4096) });
export type UnregisterDeviceInput = z.infer<typeof UnregisterDeviceInputSchema>;

/* --------------------------- admin: members / imports ---------------------- */

const csvText = z.string().max(1_000_000, 'CSV must be 1 MB or smaller');

export const ImportMembersInputSchema = z.object({
  csv: csvText,
  dryRun: z.boolean().optional(),
  /** Required to deactivate more than max(5, 20% of active members) in one import. */
  allowMassDeactivation: z.boolean().optional(),
});
export type ImportMembersInput = z.infer<typeof ImportMembersInputSchema>;

export const SetMemberRoleInputSchema = z.object({
  memberId: id,
  role: z.enum(MEMBER_ROLES),
});
export type SetMemberRoleInput = z.infer<typeof SetMemberRoleInputSchema>;

export const DeactivateMemberInputSchema = z.object({ memberId: id });
export type DeactivateMemberInput = z.infer<typeof DeactivateMemberInputSchema>;

export const ReactivateMemberInputSchema = z.object({ memberId: id });
export type ReactivateMemberInput = z.infer<typeof ReactivateMemberInputSchema>;

export const EraseMemberInputSchema = z.object({
  memberId: id,
  /** Must equal the member's current full name — a confirmation, not a lookup. */
  confirmName: z.string().trim().min(1).max(200),
});
export type EraseMemberInput = z.infer<typeof EraseMemberInputSchema>;

/* --------------------------- admin: programme ------------------------------ */

export const ImportProgrammeInputSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  weekdaysCsv: csvText,
  seriesCsv: csvText,
  singlesCsv: csvText,
  dryRun: z.boolean().optional(),
  /** Required to re-import over an already-published year. */
  replace: z.boolean().optional(),
});
export type ImportProgrammeInput = z.infer<typeof ImportProgrammeInputSchema>;

export const PublishProgrammeInputSchema = z.object({ year: z.number().int().min(2000).max(2100) });
export type PublishProgrammeInput = z.infer<typeof PublishProgrammeInputSchema>;

export const UpdateSeriesInputSchema = z
  .object({
    year: z.number().int().min(2000).max(2100),
    seriesId: id,
    name: z.string().trim().min(1).max(200).optional(),
    allowSubstitute: z.boolean().optional(),
    eligibilityNote: z.string().trim().max(500).optional(),
    generalNote: z.string().trim().max(500).optional(),
    teamMin: z.number().int().min(1).max(20).optional(),
    teamMax: z.number().int().min(1).max(20).optional(),
  })
  .strict();
export type UpdateSeriesInput = z.infer<typeof UpdateSeriesInputSchema>;

export const UpdateSessionInputSchema = z
  .object({
    year: z.number().int().min(2000).max(2100),
    sessionId: id,
    title: z.string().trim().min(1).max(200).optional(),
    partnerRequired: z.boolean().optional(),
    /** Admin removes a session by setting this true; cascades §9.3. */
    remove: z.boolean().optional(),
  })
  .strict();
export type UpdateSessionInput = z.infer<typeof UpdateSessionInputSchema>;

/* ---------------------------------- invites -------------------------------- */

export const SendInviteInputSchema = z
  .object({
    scope: z.enum(['session', 'series']),
    year,
    sessionId: id.optional(),
    seriesId: id.optional(),
    toMemberId: id,
    message: message200.optional(),
    onBehalfOfMemberId,
    force,
  })
  .refine((v) => (v.scope === 'session' ? !!v.sessionId : !!v.seriesId), {
    message: 'sessionId is required for scope=session, seriesId for scope=series',
  });
export type SendInviteInput = z.infer<typeof SendInviteInputSchema>;

export const RespondToInviteInputSchema = z.object({
  inviteId: id,
  accept: z.boolean(),
  onBehalfOfMemberId,
  force,
});
export type RespondToInviteInput = z.infer<typeof RespondToInviteInputSchema>;

export const CancelInviteInputSchema = z.object({ inviteId: id, onBehalfOfMemberId });
export type CancelInviteInput = z.infer<typeof CancelInviteInputSchema>;

/* ---------------------------------- entries -------------------------------- */

export const SetSoloStatusInputSchema = z.object({
  year,
  sessionId: id,
  status: z.enum(['looking_for_partner', 'available']),
  note: z.string().trim().max(200).optional(),
  onBehalfOfMemberId,
  force,
});
export type SetSoloStatusInput = z.infer<typeof SetSoloStatusInputSchema>;

/**
 * The solo-only shortcut of `cancelEntry` (plan §16 Phase 3a addendum): withdraw
 * a `looking_for_partner`/`available` listing. Deliberately has no
 * `onBehalfOfMemberId` — unlike every other entries mutation — because it is
 * the one case the implementer's brief specified without it; see the Phase 3a
 * report for the reasoning.
 */
export const ClearSoloStatusInputSchema = z.object({
  year,
  sessionId: id,
  force,
});
export type ClearSoloStatusInput = z.infer<typeof ClearSoloStatusInputSchema>;

export const ClaimLookingForPartnerInputSchema = z.object({
  year,
  sessionId: id,
  posterMemberId: id,
  onBehalfOfMemberId,
  force,
});
export type ClaimLookingForPartnerInput = z.infer<typeof ClaimLookingForPartnerInputSchema>;

export const SignUpWithVisitorInputSchema = z
  .object({
    scope: z.enum(['session', 'series']),
    year,
    sessionId: id.optional(),
    seriesId: id.optional(),
    visitorId: id,
    onBehalfOfMemberId,
    force,
  })
  .refine((v) => (v.scope === 'session' ? !!v.sessionId : !!v.seriesId), {
    message: 'sessionId is required for scope=session, seriesId for scope=series',
  });
export type SignUpWithVisitorInput = z.infer<typeof SignUpWithVisitorInputSchema>;

/** Which side of the pairing the named substitute stands in for (plan §9.2 design notes). */
const coverFor = z.enum(['self', 'partner']).optional();

export const SetSubstituteInputSchema = z.object({
  entryId: id,
  substitute: partnerRefInput,
  onBehalfOfMemberId,
  coverFor,
  force,
});
export type SetSubstituteInput = z.infer<typeof SetSubstituteInputSchema>;

export const ClearSubstituteInputSchema = z.object({ entryId: id, onBehalfOfMemberId });
export type ClearSubstituteInput = z.infer<typeof ClearSubstituteInputSchema>;

export const CancelEntryInputSchema = z.object({ entryId: id, onBehalfOfMemberId, force });
export type CancelEntryInput = z.infer<typeof CancelEntryInputSchema>;

/* ---------------------------------- visitors ------------------------------- */

const visitorNotes = z.string().trim().max(500);

export const CreateVisitorInputSchema = z.object({
  displayName,
  email: email.optional(),
  phone: phone.optional(),
  notes: visitorNotes.optional(),
  courtesyEmails: z.boolean().optional(),
  onBehalfOfMemberId,
});
export type CreateVisitorInput = z.infer<typeof CreateVisitorInputSchema>;

export const UpdateVisitorInputSchema = z.object({
  visitorId: id,
  displayName: displayName.optional(),
  email: email.optional(),
  phone: phone.optional(),
  notes: visitorNotes.optional(),
  courtesyEmails: z.boolean().optional(),
});
export type UpdateVisitorInput = z.infer<typeof UpdateVisitorInputSchema>;

export const DeleteVisitorInputSchema = z.object({ visitorId: id });
export type DeleteVisitorInput = z.infer<typeof DeleteVisitorInputSchema>;

/* ----------------------------------- teams --------------------------------- */

export const CreateTeamInputSchema = z.object({
  year,
  seriesId: id,
  name: z.string().trim().min(1).max(200).optional(),
  onBehalfOfMemberId,
  force,
});
export type CreateTeamInput = z.infer<typeof CreateTeamInputSchema>;

export const InviteToTeamInputSchema = z.object({
  teamId: id,
  toMemberId: id,
  message: message200.optional(),
  onBehalfOfMemberId,
  force,
});
export type InviteToTeamInput = z.infer<typeof InviteToTeamInputSchema>;

export const AddVisitorToTeamInputSchema = z.object({
  teamId: id,
  visitorId: id,
  onBehalfOfMemberId,
});
export type AddVisitorToTeamInput = z.infer<typeof AddVisitorToTeamInputSchema>;

export const RemoveVisitorFromTeamInputSchema = z.object({
  teamId: id,
  visitorId: id,
  onBehalfOfMemberId,
});
export type RemoveVisitorFromTeamInput = z.infer<typeof RemoveVisitorFromTeamInputSchema>;

export const LeaveTeamInputSchema = z.object({ teamId: id, onBehalfOfMemberId, force });
export type LeaveTeamInput = z.infer<typeof LeaveTeamInputSchema>;

export const RemoveFromTeamInputSchema = z.object({
  teamId: id,
  ref: partnerRefInput,
  onBehalfOfMemberId,
  force,
});
export type RemoveFromTeamInput = z.infer<typeof RemoveFromTeamInputSchema>;

export const TransferCaptaincyInputSchema = z.object({
  teamId: id,
  toMemberId: id,
  onBehalfOfMemberId,
});
export type TransferCaptaincyInput = z.infer<typeof TransferCaptaincyInputSchema>;

export const DisbandTeamInputSchema = z.object({ teamId: id, onBehalfOfMemberId, force });
export type DisbandTeamInput = z.infer<typeof DisbandTeamInputSchema>;

export const AddTeamSessionSubstituteInputSchema = z.object({
  teamId: id,
  sessionId: id,
  ref: partnerRefInput,
  onBehalfOfMemberId,
  force,
});
export type AddTeamSessionSubstituteInput = z.infer<typeof AddTeamSessionSubstituteInputSchema>;

export const ClearTeamSessionSubstituteInputSchema = z.object({
  teamId: id,
  sessionId: id,
  ref: partnerRefInput,
  onBehalfOfMemberId,
  force,
});
export type ClearTeamSessionSubstituteInput = z.infer<typeof ClearTeamSessionSubstituteInputSchema>;

/* ------------------------------- notifications ----------------------------- */

export const MarkNotificationsReadInputSchema = z.object({
  ids: z.array(id).min(1).max(200),
});
export type MarkNotificationsReadInput = z.infer<typeof MarkNotificationsReadInputSchema>;

/* --------------------------------- admin: misc ------------------------------ */

export const BroadcastInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
  weekdays: z.array(weekday).optional(),
});
export type BroadcastInput = z.infer<typeof BroadcastInputSchema>;

export const RunPairingSweepInputSchema = z.object({ repair: z.boolean().optional() });
export type RunPairingSweepInput = z.infer<typeof RunPairingSweepInputSchema>;

export const PingInputSchema = z.object({}).strict();
export type PingInput = z.infer<typeof PingInputSchema>;

/* -------------------------------- CSV row shapes ---------------------------- */

const csvCell = z.string();

export const MemberCsvRowSchema = z.object({
  firstName: csvCell,
  lastName: csvCell,
  email: csvCell,
  phone: csvCell,
  grade: csvCell,
});
export type MemberCsvRowInput = z.infer<typeof MemberCsvRowSchema>;

export const WeekdayCsvRowSchema = z.object({
  weekday: csvCell,
  label: csvCell,
  startTime: csvCell,
  seatedBy: csvCell,
  stewardEmail: csvCell,
  notes: csvCell,
});
export type WeekdayCsvRowInput = z.infer<typeof WeekdayCsvRowSchema>;

export const SeriesCsvRowSchema = z.object({
  weekday: csvCell,
  name: csvCell,
  scoring: csvCell,
  format: csvCell,
  bestOfN: csvCell,
  bestOfM: csvCell,
  allowSubstitute: csvCell,
  eligibilityNote: csvCell,
  note: csvCell,
  dates: csvCell,
  /** Integers as text, or blank; ignored unless format=Teams. Default 4/6. */
  teamMin: csvCell.optional(),
  teamMax: csvCell.optional(),
});
export type SeriesCsvRowInput = z.infer<typeof SeriesCsvRowSchema>;

export const SingleCsvRowSchema = z.object({
  date: csvCell,
  weekday: csvCell,
  kind: csvCell,
  title: csvCell,
  partnerRequired: csvCell,
});
export type SingleCsvRowInput = z.infer<typeof SingleCsvRowSchema>;

export { isoDate as isoDateSchema, id as idSchema, email as emailSchema, partnerRefInput as partnerRefInputSchema };

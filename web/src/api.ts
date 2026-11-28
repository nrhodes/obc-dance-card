/**
 * Typed callable bindings for every Cloud Function this app invokes. Names
 * MUST match the deployed callable names in `firebase/functions/src` (plan
 * §9.2) — the input/result types come straight from `@obc/shared` so the
 * contract can never drift.
 */
import type {
  AddTeamSessionSubstituteInput,
  AddTeamSessionSubstituteResult,
  AddVisitorToTeamInput,
  AddVisitorToTeamResult,
  BroadcastInput,
  BroadcastResult,
  CancelEntryInput,
  CancelEntryResult,
  CancelInviteInput,
  CancelInviteResult,
  ClaimLookingForPartnerInput,
  ClaimLookingForPartnerResult,
  ClearSoloStatusInput,
  ClearSoloStatusResult,
  ClearSubstituteInput,
  ClearSubstituteResult,
  ClearTeamSessionSubstituteInput,
  ClearTeamSessionSubstituteResult,
  CreateIcalFeedInput,
  CreateIcalFeedResult,
  CreateTeamInput,
  CreateTeamResult,
  CreateVisitorInput,
  CreateVisitorResult,
  AddMemberInput,
  AddMemberResult,
  DeactivateMemberInput,
  DeactivateMemberResult,
  DeleteVisitorInput,
  DeleteVisitorResult,
  DisbandTeamInput,
  DisbandTeamResult,
  EraseMemberInput,
  EraseMemberResult,
  GetIcalFeedInput,
  GetIcalFeedResult,
  ImportMembersInput,
  ImportMembersResult,
  ImportProgrammeInput,
  ImportProgrammeResult,
  InviteToTeamInput,
  InviteToTeamResult,
  LeaveTeamInput,
  LeaveTeamResult,
  ListAuditLogInput,
  ListAuditLogResult,
  MarkPasswordSetInput,
  SetPasswordInput,
  PublishProgrammeInput,
  PublishProgrammeResult,
  ReactivateMemberInput,
  ReactivateMemberResult,
  RemoveFromTeamInput,
  RemoveFromTeamResult,
  RemoveIcalFeedInput,
  RemoveIcalFeedResult,
  RemovePasswordInput,
  RemoveVisitorFromTeamInput,
  RemoveVisitorFromTeamResult,
  RequestLoginCodeInput,
  RequestLoginCodeResult,
  RespondToInviteInput,
  RespondToInviteResult,
  RotateIcalFeedInput,
  RotateIcalFeedResult,
  RunPairingSweepInput,
  RunPairingSweepResult,
  SendInviteInput,
  SendInviteResult,
  SetBulkSoloStatusInput,
  SetBulkSoloStatusResult,
  SetMemberRoleInput,
  UpdateMemberInput,
  UpdateMemberResult,
  SetMemberRoleResult,
  SetSoloStatusInput,
  SetSoloStatusResult,
  SetSubstituteInput,
  SetSubstituteResult,
  SignUpWithVisitorInput,
  SignUpWithVisitorResult,
  TransferCaptaincyInput,
  TransferCaptaincyResult,
  UpdateMyContactInput,
  UpdateMyPrefsInput,
  UpdateSeriesInput,
  UpdateSeriesResult,
  UpdateSessionInput,
  UpdateSessionResult,
  UpdateVisitorInput,
  UpdateVisitorResult,
  UpdateWeekdayInput,
  UpdateWeekdayResult,
  VerifyLoginCodeInput,
  VerifyLoginCodeResult,
} from '@obc/shared';
import { DEFAULT_CLUB_ID, type ClubId } from '@obc/shared';
import { callable } from './firebase';

/**
 * The club that club-scoped callables act in (plan §21 B14). Set by
 * `ClubProvider`, so a call carries the same club the screen is showing.
 * Module state rather than an argument at every call site because the app
 * shows one club at a time; a caller acting in a different club (the merged
 * screens of stage 4) passes `clubId` in its input, which wins.
 */
let currentClubId: ClubId = DEFAULT_CLUB_ID;

export function setCurrentClubId(clubId: ClubId): void {
  currentClubId = clubId;
}

/**
 * A callable whose input requires `clubId`. Callers leave it out and it is
 * filled in from the current club; one acting in another club passes it.
 */
function clubCallable<I extends { clubId: ClubId }, O>(name: string) {
  const call = callable<I, O>(name);
  return (input: Omit<I, 'clubId'> & { clubId?: ClubId }): Promise<O> =>
    call({ ...input, clubId: input.clubId ?? currentClubId } as I);
}


export const requestLoginCode = callable<RequestLoginCodeInput, RequestLoginCodeResult>('requestLoginCode');
export const verifyLoginCode = callable<VerifyLoginCodeInput, VerifyLoginCodeResult>('verifyLoginCode');
export const setPassword = callable<SetPasswordInput, { ok: true }>('setPassword');
export const markPasswordSet = callable<MarkPasswordSetInput, { ok: true }>('markPasswordSet');
export const removePassword = callable<RemovePasswordInput, { ok: true }>('removePassword');
export const updateMyContact = clubCallable<UpdateMyContactInput, { ok: true }>('updateMyContact');
export const updateMyPrefs = callable<UpdateMyPrefsInput, { ok: true }>('updateMyPrefs');
export const importMembers = clubCallable<ImportMembersInput, ImportMembersResult>('importMembers');
export const importProgramme = clubCallable<ImportProgrammeInput, ImportProgrammeResult>('importProgramme');
export const publishProgramme = clubCallable<PublishProgrammeInput, PublishProgrammeResult>('publishProgramme');

// Card core (plan §9.2, Phase 3b task)
export const sendInvite = clubCallable<SendInviteInput, SendInviteResult>('sendInvite');
export const respondToInvite = clubCallable<RespondToInviteInput, RespondToInviteResult>('respondToInvite');
export const cancelInvite = clubCallable<CancelInviteInput, CancelInviteResult>('cancelInvite');
export const setSoloStatus = clubCallable<SetSoloStatusInput, SetSoloStatusResult>('setSoloStatus');
export const clearSoloStatus = clubCallable<ClearSoloStatusInput, ClearSoloStatusResult>('clearSoloStatus');
export const setBulkSoloStatus = clubCallable<SetBulkSoloStatusInput, SetBulkSoloStatusResult>('setBulkSoloStatus');
export const claimLookingForPartner = clubCallable<ClaimLookingForPartnerInput, ClaimLookingForPartnerResult>(
  'claimLookingForPartner',
);
export const cancelEntry = clubCallable<CancelEntryInput, CancelEntryResult>('cancelEntry');

// iCal subscription feed (plan §21 B1)
export const getIcalFeed = clubCallable<GetIcalFeedInput, GetIcalFeedResult>('getIcalFeed');
export const createIcalFeed = clubCallable<CreateIcalFeedInput, CreateIcalFeedResult>('createIcalFeed');
export const rotateIcalFeed = clubCallable<RotateIcalFeedInput, RotateIcalFeedResult>('rotateIcalFeed');
export const removeIcalFeed = clubCallable<RemoveIcalFeedInput, RemoveIcalFeedResult>('removeIcalFeed');

// Visitors (plan §9.2, §12 — Phase 4c task)
export const createVisitor = clubCallable<CreateVisitorInput, CreateVisitorResult>('createVisitor');
export const updateVisitor = clubCallable<UpdateVisitorInput, UpdateVisitorResult>('updateVisitor');
export const deleteVisitor = clubCallable<DeleteVisitorInput, DeleteVisitorResult>('deleteVisitor');
export const signUpWithVisitor = clubCallable<SignUpWithVisitorInput, SignUpWithVisitorResult>('signUpWithVisitor');

// Substitutes (plan §9.2, §12.7/§12.8 — Phase 4c task)
export const setSubstitute = clubCallable<SetSubstituteInput, SetSubstituteResult>('setSubstitute');
export const clearSubstitute = clubCallable<ClearSubstituteInput, ClearSubstituteResult>('clearSubstitute');

// Teams (plan §9.2, §12A — Phase 4c task)
export const createTeam = clubCallable<CreateTeamInput, CreateTeamResult>('createTeam');
export const inviteToTeam = clubCallable<InviteToTeamInput, InviteToTeamResult>('inviteToTeam');
export const addVisitorToTeam = clubCallable<AddVisitorToTeamInput, AddVisitorToTeamResult>('addVisitorToTeam');
export const removeVisitorFromTeam = clubCallable<RemoveVisitorFromTeamInput, RemoveVisitorFromTeamResult>(
  'removeVisitorFromTeam',
);
export const leaveTeam = clubCallable<LeaveTeamInput, LeaveTeamResult>('leaveTeam');
export const removeFromTeam = clubCallable<RemoveFromTeamInput, RemoveFromTeamResult>('removeFromTeam');
export const transferCaptaincy = clubCallable<TransferCaptaincyInput, TransferCaptaincyResult>('transferCaptaincy');
export const disbandTeam = clubCallable<DisbandTeamInput, DisbandTeamResult>('disbandTeam');
export const addTeamSessionSubstitute = clubCallable<AddTeamSessionSubstituteInput, AddTeamSessionSubstituteResult>(
  'addTeamSessionSubstitute',
);
export const clearTeamSessionSubstitute = clubCallable<ClearTeamSessionSubstituteInput, ClearTeamSessionSubstituteResult>(
  'clearTeamSessionSubstitute',
);

// Admin: members / on-behalf / integrity (plan §9.2, §16 Phase 6 — Phase 6b task)
export const addMember = clubCallable<AddMemberInput, AddMemberResult>('addMember');
export const updateMember = clubCallable<UpdateMemberInput, UpdateMemberResult>('updateMember');
export const setMemberRole = clubCallable<SetMemberRoleInput, SetMemberRoleResult>('setMemberRole');
export const deactivateMember = clubCallable<DeactivateMemberInput, DeactivateMemberResult>('deactivateMember');
export const reactivateMember = clubCallable<ReactivateMemberInput, ReactivateMemberResult>('reactivateMember');
export const eraseMember = clubCallable<EraseMemberInput, EraseMemberResult>('eraseMember');
export const updateSeries = clubCallable<UpdateSeriesInput, UpdateSeriesResult>('updateSeries');
export const updateSession = clubCallable<UpdateSessionInput, UpdateSessionResult>('updateSession');
export const updateWeekday = clubCallable<UpdateWeekdayInput, UpdateWeekdayResult>('updateWeekday');
export const broadcast = clubCallable<BroadcastInput, BroadcastResult>('broadcast');
export const listAuditLog = clubCallable<ListAuditLogInput, ListAuditLogResult>('listAuditLog');
export const runPairingSweep = clubCallable<RunPairingSweepInput, RunPairingSweepResult>('runPairingSweep');

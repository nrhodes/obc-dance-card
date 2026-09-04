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
  MarkNotificationsReadInput,
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
  VerifyLoginCodeInput,
  VerifyLoginCodeResult,
} from '@obc/shared';
import { callable } from './firebase';

export const requestLoginCode = callable<RequestLoginCodeInput, RequestLoginCodeResult>('requestLoginCode');
export const verifyLoginCode = callable<VerifyLoginCodeInput, VerifyLoginCodeResult>('verifyLoginCode');
export const setPassword = callable<SetPasswordInput, { ok: true }>('setPassword');
export const markPasswordSet = callable<MarkPasswordSetInput, { ok: true }>('markPasswordSet');
export const removePassword = callable<RemovePasswordInput, { ok: true }>('removePassword');
export const updateMyContact = callable<UpdateMyContactInput, { ok: true }>('updateMyContact');
export const updateMyPrefs = callable<UpdateMyPrefsInput, { ok: true }>('updateMyPrefs');
export const importMembers = callable<ImportMembersInput, ImportMembersResult>('importMembers');
export const importProgramme = callable<ImportProgrammeInput, ImportProgrammeResult>('importProgramme');
export const publishProgramme = callable<PublishProgrammeInput, PublishProgrammeResult>('publishProgramme');

// Card core (plan §9.2, Phase 3b task)
export const sendInvite = callable<SendInviteInput, SendInviteResult>('sendInvite');
export const respondToInvite = callable<RespondToInviteInput, RespondToInviteResult>('respondToInvite');
export const cancelInvite = callable<CancelInviteInput, CancelInviteResult>('cancelInvite');
export const setSoloStatus = callable<SetSoloStatusInput, SetSoloStatusResult>('setSoloStatus');
export const clearSoloStatus = callable<ClearSoloStatusInput, ClearSoloStatusResult>('clearSoloStatus');
export const setBulkSoloStatus = callable<SetBulkSoloStatusInput, SetBulkSoloStatusResult>('setBulkSoloStatus');
export const claimLookingForPartner = callable<ClaimLookingForPartnerInput, ClaimLookingForPartnerResult>(
  'claimLookingForPartner',
);
export const cancelEntry = callable<CancelEntryInput, CancelEntryResult>('cancelEntry');
export const markNotificationsRead = callable<MarkNotificationsReadInput, { ok: true }>('markNotificationsRead');

// iCal subscription feed (plan §21 B1)
export const getIcalFeed = callable<GetIcalFeedInput, GetIcalFeedResult>('getIcalFeed');
export const createIcalFeed = callable<CreateIcalFeedInput, CreateIcalFeedResult>('createIcalFeed');
export const rotateIcalFeed = callable<RotateIcalFeedInput, RotateIcalFeedResult>('rotateIcalFeed');
export const removeIcalFeed = callable<RemoveIcalFeedInput, RemoveIcalFeedResult>('removeIcalFeed');

// Visitors (plan §9.2, §12 — Phase 4c task)
export const createVisitor = callable<CreateVisitorInput, CreateVisitorResult>('createVisitor');
export const updateVisitor = callable<UpdateVisitorInput, UpdateVisitorResult>('updateVisitor');
export const deleteVisitor = callable<DeleteVisitorInput, DeleteVisitorResult>('deleteVisitor');
export const signUpWithVisitor = callable<SignUpWithVisitorInput, SignUpWithVisitorResult>('signUpWithVisitor');

// Substitutes (plan §9.2, §12.7/§12.8 — Phase 4c task)
export const setSubstitute = callable<SetSubstituteInput, SetSubstituteResult>('setSubstitute');
export const clearSubstitute = callable<ClearSubstituteInput, ClearSubstituteResult>('clearSubstitute');

// Teams (plan §9.2, §12A — Phase 4c task)
export const createTeam = callable<CreateTeamInput, CreateTeamResult>('createTeam');
export const inviteToTeam = callable<InviteToTeamInput, InviteToTeamResult>('inviteToTeam');
export const addVisitorToTeam = callable<AddVisitorToTeamInput, AddVisitorToTeamResult>('addVisitorToTeam');
export const removeVisitorFromTeam = callable<RemoveVisitorFromTeamInput, RemoveVisitorFromTeamResult>(
  'removeVisitorFromTeam',
);
export const leaveTeam = callable<LeaveTeamInput, LeaveTeamResult>('leaveTeam');
export const removeFromTeam = callable<RemoveFromTeamInput, RemoveFromTeamResult>('removeFromTeam');
export const transferCaptaincy = callable<TransferCaptaincyInput, TransferCaptaincyResult>('transferCaptaincy');
export const disbandTeam = callable<DisbandTeamInput, DisbandTeamResult>('disbandTeam');
export const addTeamSessionSubstitute = callable<AddTeamSessionSubstituteInput, AddTeamSessionSubstituteResult>(
  'addTeamSessionSubstitute',
);
export const clearTeamSessionSubstitute = callable<ClearTeamSessionSubstituteInput, ClearTeamSessionSubstituteResult>(
  'clearTeamSessionSubstitute',
);

// Admin: members / on-behalf / integrity (plan §9.2, §16 Phase 6 — Phase 6b task)
export const setMemberRole = callable<SetMemberRoleInput, SetMemberRoleResult>('setMemberRole');
export const deactivateMember = callable<DeactivateMemberInput, DeactivateMemberResult>('deactivateMember');
export const reactivateMember = callable<ReactivateMemberInput, ReactivateMemberResult>('reactivateMember');
export const eraseMember = callable<EraseMemberInput, EraseMemberResult>('eraseMember');
export const updateSeries = callable<UpdateSeriesInput, UpdateSeriesResult>('updateSeries');
export const updateSession = callable<UpdateSessionInput, UpdateSessionResult>('updateSession');
export const broadcast = callable<BroadcastInput, BroadcastResult>('broadcast');
export const listAuditLog = callable<ListAuditLogInput, ListAuditLogResult>('listAuditLog');
export const runPairingSweep = callable<RunPairingSweepInput, RunPairingSweepResult>('runPairingSweep');

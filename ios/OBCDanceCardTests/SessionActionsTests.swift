//
//  SessionActionsTests.swift
//  Ported from `web/src/lib/sessionActions.test.ts`. Each test pins one
//  branch of the plan §6/§9.2 precedence order, plus the §9.3 cancel copy.
//

import XCTest
@testable import OBCDanceCard

final class SessionActionsTests: XCTestCase {

    private let emptyRoster = SessionRosterView()

    private func derive(
        ownEntry: Entry?,
        session: Session = Fx.session(),
        weekday: WeekdayProgramme = Fx.weekday(),
        roster: SessionRosterView? = nil,
        now: Date = Fx.beforeCutoff,
        context: SessionActionsContext = SessionActionsContext()
    ) -> SessionActionsResult {
        SessionActions.derive(
            ownEntry: ownEntry,
            session: session,
            weekday: weekday,
            roster: roster ?? emptyRoster,
            now: now,
            context: context
        )
    }

    // MARK: - Precedence

    func testNoBridgeSessionHasNoActionsEvenWithAnEntry() {
        let result = derive(
            ownEntry: Fx.entry(status: .confirmed),
            session: Fx.session(kind: .noBridge, format: nil)
        )
        XCTAssertEqual(result.state, .noBridge)
        XCTAssertFalse(result.canActOnRoster)
    }

    func testLockedSessionHasNoActionsRegardlessOfFormat() {
        let result = derive(ownEntry: nil, now: Fx.afterCutoff)
        XCTAssertEqual(result.state, .locked)
        XCTAssertFalse(result.canActOnRoster)
        XCTAssertTrue(result.claimableMemberIds.isEmpty)
    }

    /// The lock is the session's *start* time, not midnight (plan §6/I7).
    func testSessionIsStillOpenMomentsBeforeTheStartTime() {
        let justBefore = Fx.instant("2027-01-10T23:59:00Z") // 12:59 NZDT
        let result = derive(ownEntry: nil, now: justBefore)
        XCTAssertEqual(result.state, .noEntryOpen)
    }

    func testLockBeatsTheTeamsBranch() {
        let result = derive(
            ownEntry: nil,
            session: Fx.session(seriesId: Fx.teamsSeriesId, format: .teams),
            now: Fx.afterCutoff,
            context: SessionActionsContext(series: Fx.series(format: .teams), actorMemberId: "member-a")
        )
        XCTAssertEqual(result.state, .locked)
    }

    // MARK: - No entry

    func testNoEntryOffersEverythingAndCanActOnTheRoster() {
        let roster = SessionRosterView(
            pairs: [],
            lookingForPartner: [SoloRow(memberId: "member-b", name: "John Smith", note: nil)],
            available: [SoloRow(memberId: "member-c", name: "Amy Lee", note: nil)]
        )
        let result = derive(ownEntry: nil, roster: roster)
        XCTAssertEqual(result.state, .noEntryOpen)
        XCTAssertTrue(result.canActOnRoster)
        XCTAssertEqual(result.claimableMemberIds, ["member-b"])
        XCTAssertEqual(result.inviteableMemberIds, ["member-c"])
    }

    /// A cancelled entry occupies no slot — it must read exactly like having
    /// never signed up (`isFree`).
    func testCancelledEntryIsTreatedAsNoEntry() {
        let result = derive(ownEntry: Fx.entry(status: .cancelled))
        XCTAssertEqual(result.state, .noEntryOpen)
        XCTAssertTrue(result.canActOnRoster)
    }

    func testOwnRowIsNeverOfferedAsAClaimTarget() {
        let roster = SessionRosterView(
            pairs: [],
            lookingForPartner: [
                SoloRow(memberId: "member-a", name: "Jane Doe", note: nil),
                SoloRow(memberId: "member-b", name: "John Smith", note: nil),
            ],
            available: []
        )
        let result = derive(
            ownEntry: Fx.entry(memberId: "member-a", status: .cancelled),
            roster: roster
        )
        XCTAssertEqual(result.claimableMemberIds, ["member-b"])
    }

    // MARK: - Solo

    func testLookingForPartnerCarriesItsNoteAndOffersNoRosterActions() {
        let result = derive(ownEntry: Fx.entry(status: .lookingForPartner, note: "Happy to play up"))
        XCTAssertEqual(result.state, .solo(status: .lookingForPartner, note: "Happy to play up"))
        XCTAssertFalse(result.canActOnRoster)
    }

    func testAvailableWithoutANote() {
        let result = derive(ownEntry: Fx.entry(status: .available))
        XCTAssertEqual(result.state, .solo(status: .available, note: nil))
    }

    // MARK: - Confirmed and substitutes

    func testConfirmedWithAMemberPartnerCanArrangeASubstitute() {
        let partner = PartnerRef.member(memberId: "member-b", displayName: "John Smith")
        let result = derive(
            ownEntry: Fx.entry(status: .confirmed, partner: partner, pairingId: "p1"),
            context: SessionActionsContext(series: Fx.series(allowSubstitute: true))
        )
        XCTAssertEqual(
            result.state,
            .confirmed(partner: partner, partnerSubstitute: nil, substituteOption: .available)
        )
    }

    func testSeriesThatForbidsSubstitutesReportsNotAllowed() {
        let partner = PartnerRef.member(memberId: "member-b", displayName: "John Smith")
        let result = derive(
            ownEntry: Fx.entry(status: .confirmed, partner: partner, pairingId: "p1"),
            context: SessionActionsContext(series: Fx.series(allowSubstitute: false))
        )
        XCTAssertEqual(
            result.state,
            .confirmed(partner: partner, partnerSubstitute: nil, substituteOption: .notAllowed)
        )
    }

    /// Substitution isn't modelled for visitor pairings (§12.8) — and that
    /// beats `allowSubstitute`, which is why the series here allows them.
    func testVisitorPartnerReportsVisitorPairing() {
        let partner = PartnerRef.visitor(visitorId: "v1", displayName: "Bob Visitor")
        let result = derive(
            ownEntry: Fx.entry(status: .confirmed, partner: partner, pairingId: "p1"),
            context: SessionActionsContext(series: Fx.series(allowSubstitute: true))
        )
        XCTAssertEqual(
            result.state,
            .confirmed(partner: partner, partnerSubstitute: nil, substituteOption: .visitorPairing)
        )
    }

    func testRemainingPartnerSeesTheArrangedSubstitute() {
        let partner = PartnerRef.member(memberId: "member-b", displayName: "John Smith")
        let sub = PartnerRef.member(memberId: "member-c", displayName: "Amy Lee")
        let result = derive(
            ownEntry: Fx.entry(status: .confirmed, partner: partner, pairingId: "p1", partnerSubstitute: sub),
            context: SessionActionsContext(series: Fx.series(allowSubstitute: true))
        )
        XCTAssertEqual(
            result.state,
            .confirmed(partner: partner, partnerSubstitute: sub, substituteOption: .arranged(substitute: sub))
        )
    }

    func testCoveredMemberSeesTheSubstitutedState() {
        let partner = PartnerRef.member(memberId: "member-b", displayName: "John Smith")
        let sub = PartnerRef.member(memberId: "member-c", displayName: "Amy Lee")
        let result = derive(
            ownEntry: Fx.entry(status: .substituted, partner: partner, pairingId: "p1", substitute: sub)
        )
        XCTAssertEqual(result.state, .substituted(partner: partner, substitute: sub))
    }

    /// A stand-in's own entry takes precedence over its status.
    func testSubstitutesOwnEntryReportsTheSubState() {
        let result = derive(
            ownEntry: Fx.entry(status: .confirmed, pairingId: "p1", isSubstituteFor: "member-b")
        )
        XCTAssertEqual(result.state, .sub(isSubstituteFor: "member-b"))
    }

    // MARK: - Teams

    private func teamsSession() -> Session {
        Fx.session(seriesId: Fx.teamsSeriesId, format: .teams)
    }

    func testTeamsBranchWinsOverTheMembersOwnEntry() {
        let result = derive(
            ownEntry: Fx.entry(status: .confirmed, teamId: "monday-campbell-cave-teams-member-a"),
            session: teamsSession(),
            context: SessionActionsContext(
                series: Fx.series(format: .teams),
                team: Fx.team(),
                actorMemberId: "member-b"
            )
        )
        XCTAssertEqual(
            result.state,
            .teamsFormat(hasOwnEntry: true, teamId: "monday-campbell-cave-teams-member-a", role: .member)
        )
    }

    func testCaptainWithSpaceCanClaimAndInvite() {
        let roster = SessionRosterView(
            pairs: [],
            lookingForPartner: [SoloRow(memberId: "member-c", name: "Amy Lee", note: nil)],
            available: [SoloRow(memberId: "member-d", name: "Bob Brown", note: nil)]
        )
        let result = derive(
            ownEntry: nil,
            session: teamsSession(),
            roster: roster,
            context: SessionActionsContext(
                series: Fx.series(format: .teams, teamMax: 6),
                team: Fx.team(),
                actorMemberId: "member-a"
            )
        )
        XCTAssertEqual(
            result.state,
            .teamsFormat(
                hasOwnEntry: false,
                teamId: "monday-campbell-cave-teams-member-a",
                role: .captain(full: false, hasAbsence: false)
            )
        )
        XCTAssertTrue(result.canActOnRoster)
        XCTAssertEqual(result.claimableMemberIds, ["member-c"])
        XCTAssertEqual(result.inviteableMemberIds, ["member-d"])
    }

    func testFullTeamCaptainCannotClaim() {
        let roster = SessionRosterView(
            pairs: [],
            lookingForPartner: [SoloRow(memberId: "member-c", name: "Amy Lee", note: nil)],
            available: []
        )
        let result = derive(
            ownEntry: nil,
            session: teamsSession(),
            roster: roster,
            context: SessionActionsContext(
                series: Fx.series(format: .teams, teamMax: 2),
                team: Fx.team(), // exactly 2 members
                actorMemberId: "member-a"
            )
        )
        XCTAssertEqual(
            result.state,
            .teamsFormat(
                hasOwnEntry: false,
                teamId: "monday-campbell-cave-teams-member-a",
                role: .captain(full: true, hasAbsence: false)
            )
        )
        XCTAssertFalse(result.canActOnRoster)
        XCTAssertTrue(result.claimableMemberIds.isEmpty)
    }

    func testAbsenceGateIsCarriedThroughToTheCaptain() {
        let result = derive(
            ownEntry: nil,
            session: teamsSession(),
            context: SessionActionsContext(
                series: Fx.series(format: .teams),
                team: Fx.team(),
                actorMemberId: "member-a",
                hasAbsence: true
            )
        )
        XCTAssertEqual(
            result.state,
            .teamsFormat(
                hasOwnEntry: false,
                teamId: "monday-campbell-cave-teams-member-a",
                role: .captain(full: false, hasAbsence: true)
            )
        )
    }

    func testNotOnATeamCarriesAnyNoticeboardListing() {
        let result = derive(
            ownEntry: Fx.entry(status: .lookingForPartner, note: "Keen"),
            session: teamsSession(),
            context: SessionActionsContext(series: Fx.series(format: .teams), actorMemberId: "member-a")
        )
        XCTAssertEqual(
            result.state,
            .teamsFormat(
                hasOwnEntry: true,
                teamId: nil,
                role: .notOnTeam(solo: TeamsRole.SoloListing(status: .lookingForPartner, note: "Keen"))
            )
        )
    }

    func testNotOnATeamWithNoListing() {
        let result = derive(
            ownEntry: nil,
            session: teamsSession(),
            context: SessionActionsContext(series: Fx.series(format: .teams), actorMemberId: "member-a")
        )
        XCTAssertEqual(
            result.state,
            .teamsFormat(hasOwnEntry: false, teamId: nil, role: .notOnTeam(solo: nil))
        )
    }

    // MARK: - Cancel copy (plan §9.3)

    func testCancelCopyForATeamEntry() {
        let text = SessionActions.describeCancelConsequence(Fx.entry(status: .confirmed, teamId: "t1"))
        XCTAssertEqual(
            text,
            "The team captain will be told you can't play this session. Your team is unaffected."
        )
    }

    func testCancelCopyForAStandIn() {
        let text = SessionActions.describeCancelConsequence(
            Fx.entry(status: .confirmed, isSubstituteFor: "member-b")
        )
        XCTAssertTrue(text.hasPrefix("This cancels your one-week stand-in arrangement."))
    }

    func testCancelCopyForACoveredMemberNamesTheSubAndThePartner() {
        let text = SessionActions.describeCancelConsequence(Fx.entry(
            status: .substituted,
            partner: .member(memberId: "member-b", displayName: "John Smith"),
            substitute: .member(memberId: "member-c", displayName: "Amy Lee")
        ))
        XCTAssertEqual(
            text,
            "Amy Lee will become John Smith's partner for this session, and you will be removed from it."
        )
    }

    func testCancelCopyForAVisitorPartner() {
        let text = SessionActions.describeCancelConsequence(Fx.entry(
            status: .confirmed,
            partner: .visitor(visitorId: "v1", displayName: "Bob Visitor")
        ))
        XCTAssertEqual(
            text,
            "Bob Visitor will no longer be listed as your partner for this session."
        )
    }

    func testCancelCopyForAMemberPartnerMentionsATrailingSubstitute() {
        let text = SessionActions.describeCancelConsequence(Fx.entry(
            status: .confirmed,
            partner: .member(memberId: "member-b", displayName: "John Smith"),
            partnerSubstitute: .member(memberId: "member-c", displayName: "Amy Lee")
        ))
        XCTAssertEqual(
            text,
            "John Smith will be told you've cancelled and will be shown as looking for a partner."
            + " Amy Lee's arrangement to stand in for John Smith this session will also be cancelled."
        )
    }

    func testCancelCopyFallsBackForASoloEntry() {
        let text = SessionActions.describeCancelConsequence(Fx.entry(status: .lookingForPartner))
        XCTAssertEqual(text, "This will remove your entry for this session.")
    }
}

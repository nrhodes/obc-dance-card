//
//  SupportTests.swift
//  Team logic, programme timeline, member picker, formatting, deep links and
//  error mapping — ported from `web/src/lib/{team,programmeView,memberPicker,
//  format,actionErrors}.test.ts` and `web/src/push/deepLink.test.ts`.
//

import XCTest
@testable import OBCDanceCard

final class TeamLogicTests: XCTestCase {

    func testStatusLabelReadsRosterSizeAgainstTheSeriesBounds() {
        XCTAssertEqual(
            TeamLogic.statusLabel(team: Fx.team(status: .forming), series: Fx.series(teamMin: 4, teamMax: 6)),
            "Forming (2 of 4–6)"
        )
        XCTAssertEqual(
            TeamLogic.statusLabel(team: Fx.team(status: .active), series: Fx.series(teamMin: 4, teamMax: 6)),
            "Active (2 of 4–6)"
        )
    }

    func testIsFullComparesAgainstTeamMax() {
        XCTAssertTrue(TeamLogic.isFull(team: Fx.team(), series: Fx.series(teamMax: 2)))
        XCTAssertFalse(TeamLogic.isFull(team: Fx.team(), series: Fx.series(teamMax: 6)))
    }

    func testSessionViewFindsAbsencesAmongRosteredMembersOnly() {
        let team = Fx.team()
        let entries = [
            // A rostered member who cancelled this session: an absence.
            Fx.entry(id: "e1", memberId: "member-b", status: .cancelled, teamId: team.id),
            // Someone not on the roster cancelling is not this team's absence.
            Fx.entry(id: "e2", memberId: "member-z", status: .cancelled, teamId: team.id),
        ]
        let view = TeamLogic.sessionView(team: team, sessionEntries: entries, sessionId: Fx.sessionId)
        XCTAssertEqual(view.absentMemberIds, ["member-b"])
        XCTAssertTrue(view.hasAbsence)
    }

    func testMemberSubstitutesAreTheTeamSessionOnlyEntries() {
        let team = Fx.team()
        let entries = [
            Fx.entry(id: "e1", memberId: "member-b", status: .cancelled, teamId: team.id),
            Fx.entry(id: "e2", memberId: "member-c", status: .confirmed, teamId: team.id, teamSessionOnly: true),
            // A cancelled session-only sub no longer stands in.
            Fx.entry(id: "e3", memberId: "member-d", status: .cancelled, teamId: team.id, teamSessionOnly: true),
        ]
        let view = TeamLogic.sessionView(team: team, sessionEntries: entries, sessionId: Fx.sessionId)
        XCTAssertEqual(view.memberSubstitutes.map(\.memberId), ["member-c"])
        XCTAssertEqual(view.absentMemberIds, ["member-b"])
    }

    /// A visitor sub has no entry of its own, so it is recorded on the team
    /// doc (plan §5.9).
    func testVisitorSubstitutesComeFromTheTeamDoc() {
        let ref = PartnerRef.visitor(visitorId: "v1", displayName: "Bob Visitor")
        let team = Fx.team(sessionVisitors: [Fx.sessionId: [ref]])
        let view = TeamLogic.sessionView(team: team, sessionEntries: [], sessionId: Fx.sessionId)
        XCTAssertEqual(view.visitorSubstitutes, [ref])
        XCTAssertFalse(view.hasAbsence)
    }

    func testEntriesForAnotherSessionOrTeamAreIgnored() {
        let team = Fx.team()
        let entries = [
            Fx.entry(id: "e1", sessionId: "other-session", memberId: "member-b", status: .cancelled, teamId: team.id),
            Fx.entry(id: "e2", memberId: "member-b", status: .cancelled, teamId: "other-team"),
        ]
        let view = TeamLogic.sessionView(team: team, sessionEntries: entries, sessionId: Fx.sessionId)
        XCTAssertTrue(view.isEmpty)
    }
}

final class ProgrammeTimelineTests: XCTestCase {

    func testSeriesAndSinglesAreInterleavedByDate() {
        let seriesA = Fx.series(id: "s-a", name: "A", order: 0)
        let seriesB = Fx.series(id: "s-b", name: "B", order: 1)
        let sessions = [
            Fx.session(id: "s-a-1", date: "2027-01-11", seriesId: "s-a"),
            Fx.session(id: "single-1", date: "2027-02-01", seriesId: nil, kind: .holidayBridge, title: "Holiday Bridge"),
            Fx.session(id: "s-b-1", date: "2027-03-01", seriesId: "s-b"),
        ]
        let items = ProgrammeTimeline.build(weekday: .monday, series: [seriesA, seriesB], sessions: sessions)
        XCTAssertEqual(items.map(\.anchorDate), ["2027-01-11", "2027-02-01", "2027-03-01"])
        XCTAssertEqual(items.map(\.id), ["series:s-a", "single:single-1", "series:s-b"])
    }

    func testASeriesAnchorsOnItsFirstSessionAndKeepsThemInDateOrder() {
        let series = Fx.series(id: "s-a")
        let sessions = [
            Fx.session(id: "s-a-2", date: "2027-01-18", seriesId: "s-a"),
            Fx.session(id: "s-a-1", date: "2027-01-11", seriesId: "s-a"),
        ]
        let items = ProgrammeTimeline.build(weekday: .monday, series: [series], sessions: sessions)
        guard case let .series(_, ordered, anchor) = items[0] else { return XCTFail("expected a series item") }
        XCTAssertEqual(anchor, "2027-01-11")
        XCTAssertEqual(ordered.map(\.date), ["2027-01-11", "2027-01-18"])
    }

    func testASeriesWithNoSessionsIsSkipped() {
        let items = ProgrammeTimeline.build(weekday: .monday, series: [Fx.series(id: "s-a")], sessions: [])
        XCTAssertTrue(items.isEmpty)
    }

    func testDefaultWeekdayFallsBackToMondayOnAWeekend() {
        // 2027-01-16 (NZ) is a Saturday.
        XCTAssertEqual(ProgrammeTimeline.defaultWeekday(now: Fx.instant("2027-01-16T02:00:00Z")), .monday)
        // 2027-01-13 (NZ) is a Wednesday.
        XCTAssertEqual(ProgrammeTimeline.defaultWeekday(now: Fx.instant("2027-01-13T02:00:00Z")), .wednesday)
    }

    func testWeekdaysWithDataKeepsMondayToFridayOrder() {
        XCTAssertEqual(
            ProgrammeTimeline.weekdaysWithData([.friday, .monday, .wednesday]),
            [.monday, .wednesday, .friday]
        )
    }
}

final class MemberPickerTests: XCTestCase {

    private let members = [
        Fx.member(id: "member-b", first: "John", last: "Smith"),
        Fx.member(id: "member-a", first: "Jane", last: "Doe"),
        Fx.member(id: "member-c", first: "Amy", last: "Lee", grade: .junior),
    ]

    func testExcludesSelfAndTheAlreadyConfirmed() {
        let result = MemberPicker.filter(members, selfId: "member-a", excludeMemberIds: ["member-b"], query: "")
        XCTAssertEqual(result.map(\.id), ["member-c"])
    }

    func testSearchesAcrossTheWholeNameCaseInsensitively() {
        XCTAssertEqual(
            MemberPicker.filter(members, selfId: "", excludeMemberIds: [], query: "jane d").map(\.id),
            ["member-a"]
        )
        XCTAssertEqual(
            MemberPicker.filter(members, selfId: "", excludeMemberIds: [], query: "SMITH").map(\.id),
            ["member-b"]
        )
    }

    func testSortsByFullName() {
        XCTAssertEqual(
            MemberPicker.filter(members, selfId: "", excludeMemberIds: [], query: "").map(\.fullName),
            ["Amy Lee", "Jane Doe", "John Smith"]
        )
    }
}

final class FormatTests: XCTestCase {

    func testDateRendersTheStoredNZCalendarDate() {
        XCTAssertEqual(Fmt.date("2027-01-11"), "Mon 11 Jan 2027")
        // Either side of both DST transitions the label must still be the
        // date's own calendar day, never a neighbour.
        XCTAssertEqual(Fmt.date("2027-04-04"), "Sun 4 Apr 2027")
        XCTAssertEqual(Fmt.date("2027-09-26"), "Sun 26 Sep 2027")
    }

    func testDateFallsBackToTheRawValueWhenUnparseable() {
        XCTAssertEqual(Fmt.date("nonsense"), "nonsense")
    }

    func testTimeOfDayIsTwelveHourWithALowercaseSuffix() {
        XCTAssertEqual(Fmt.timeOfDay("13:00"), "1:00pm")
        XCTAssertEqual(Fmt.timeOfDay("07:00"), "7:00am")
        XCTAssertEqual(Fmt.timeOfDay("00:30"), "12:30am")
        XCTAssertEqual(Fmt.timeOfDay("12:00"), "12:00pm")
        XCTAssertEqual(Fmt.timeOfDay("19:45"), "7:45pm")
    }

    func testTimeOfDayFallsBackToTheRawValue() {
        XCTAssertEqual(Fmt.timeOfDay("25:00"), "25:00")
        XCTAssertEqual(Fmt.timeOfDay("lunchtime"), "lunchtime")
    }

    func testInstantParsingAcceptsBothIsoShapesTheServerWrites() {
        XCTAssertNotNil(Fmt.parseInstant("2027-01-12T00:00:00.000Z"))
        XCTAssertNotNil(Fmt.parseInstant("2027-01-12T00:00:00Z"))
        XCTAssertNil(Fmt.parseInstant("not an instant"))
    }

    func testPluralisation() {
        XCTAssertEqual(Fmt.pluralised(1, "session"), "1 session")
        XCTAssertEqual(Fmt.pluralised(4, "session"), "4 sessions")
        XCTAssertEqual(Fmt.pluralised(0, "member"), "0 members")
    }
}

final class DeepLinkTests: XCTestCase {

    func testSessionPayloadResolvesToTheSessionPage() {
        XCTAssertEqual(
            DeepLink.resolve(["sessionId": "s1", "year": "2027"]),
            .session(year: 2027, sessionId: "s1")
        )
    }

    /// FCM delivers everything as strings, but an in-app `notifications` doc
    /// could carry a number — both must work.
    func testYearIsAcceptedAsAStringOrANumber() {
        XCTAssertEqual(
            DeepLink.resolve(["sessionId": "s1", "year": 2027]),
            .session(year: 2027, sessionId: "s1")
        )
    }

    func testInvitePayloadResolvesToInvites() {
        XCTAssertEqual(DeepLink.resolve(["inviteId": "i1"]), .invites)
    }

    /// A session id without a year can't address a session, so it falls
    /// through rather than guessing one.
    func testAPartialSessionPayloadFallsThrough() {
        XCTAssertEqual(DeepLink.resolve(["sessionId": "s1"]), .notifications)
    }

    func testAnEmptyPayloadOpensTheFeed() {
        XCTAssertEqual(DeepLink.resolve([:]), .notifications)
    }
}

final class ErrorMappingTests: XCTestCase {

    private func appError(_ code: String, _ message: String = "boom") -> AppError {
        AppError(code: code, message: message)
    }

    /// `failed-precondition` messages are written server-side to be
    /// display-safe (they name conflicting dates) and are shown verbatim.
    func testFailedPreconditionIsShownVerbatim() {
        XCTAssertEqual(
            ErrorMapper.action(appError("failed-precondition", "You already play on 11 Jan.")),
            "You already play on 11 Jan."
        )
    }

    func testOtherActionCodesGetFixedCopy() {
        XCTAssertEqual(ErrorMapper.action(appError("resource-exhausted")), "Too many invites today")
        XCTAssertEqual(ErrorMapper.action(appError("permission-denied")), "You can't do that.")
        XCTAssertEqual(ErrorMapper.action(appError("not-found")), "Something went wrong. Please try again.")
    }

    func testCodeFlowMapping() {
        XCTAssertEqual(
            ErrorMapper.codeFlow(appError("resource-exhausted")),
            "Too many attempts. Please wait a few minutes and try again."
        )
        XCTAssertEqual(
            ErrorMapper.codeFlow(appError("invalid-argument")),
            "That code is not valid. Request a new one."
        )
        // A Cloud Run 429 or timeout is "try again shortly", not a mistake
        // the member made.
        let busy = "The service is busy right now. Please wait a moment and try again."
        XCTAssertEqual(ErrorMapper.codeFlow(appError("unavailable")), busy)
        XCTAssertEqual(ErrorMapper.codeFlow(appError("deadline-exceeded")), busy)
    }

    /// Plan §8.1: an unknown email and a wrong password must be
    /// indistinguishable.
    func testPasswordSignInCopyIsIdenticalWhateverWentWrong() {
        let a = ErrorMapper.passwordSignIn(appError("not-found"))
        let b = ErrorMapper.passwordSignIn(appError("permission-denied"))
        XCTAssertEqual(a, b)
        XCTAssertEqual(a, ErrorMapper.passwordMismatch)
    }

    func testPasswordStrengthMirrorsTheSharedPolicy() {
        XCTAssertEqual(passwordStrengthError("short1"), "Password must be at least 8 characters.")
        XCTAssertEqual(passwordStrengthError("12345678"), "Password must include at least one letter.")
        XCTAssertEqual(passwordStrengthError("abcdefgh"), "Password must include at least one number.")
        XCTAssertNil(passwordStrengthError("abcdefg1"))
    }
}

final class PayloadTests: XCTestCase {

    /// The server zod-parses `req.data`, and an `.optional()` field rejects an
    /// explicit null — so a nil must be *omitted*, not sent.
    func testNilValuesAreOmittedRatherThanSentAsNull() {
        let result = payload(["a": "x", "b": nil, "c": 3])
        XCTAssertEqual(Set(result.keys), ["a", "c"])
        XCTAssertNil(result["b"])
    }

    func testPartnerRefInputPayloadShapes() {
        XCTAssertEqual(
            PartnerRefInput.member(memberId: "m1").payload as? [String: String],
            ["kind": "member", "memberId": "m1"]
        )
        XCTAssertEqual(
            PartnerRefInput.visitor(visitorId: "v1").payload as? [String: String],
            ["kind": "visitor", "visitorId": "v1"]
        )
    }
}

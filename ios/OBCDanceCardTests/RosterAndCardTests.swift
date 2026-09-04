//
//  RosterAndCardTests.swift
//  Ported from `web/src/lib/roster.test.ts` and `card.test.ts`.
//

import XCTest
@testable import OBCDanceCard

final class RosterTests: XCTestCase {

    private func pair(_ a: String, _ b: String, pairingId: String) -> [Entry] {
        [
            Fx.entry(id: "\(pairingId)-\(a)", memberId: a, status: .confirmed,
                     partner: .member(memberId: b, displayName: Fx.nameOf(b)), pairingId: pairingId),
            Fx.entry(id: "\(pairingId)-\(b)", memberId: b, status: .confirmed,
                     partner: .member(memberId: a, displayName: Fx.nameOf(a)), pairingId: pairingId),
        ]
    }

    func testTwoMemberEntriesDedupeIntoOneRow() {
        let rows = Roster.buildPairs(entries: pair("member-a", "member-b", pairingId: "p1"), nameOf: Fx.nameOf)
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].aName, "Jane Doe")
        XCTAssertEqual(rows[0].bName, "John Smith")
        XCTAssertFalse(rows[0].isVisitor)
        XCTAssertNil(rows[0].substitute)
    }

    /// A visitor has no entry of its own, so the pairing is a single entry —
    /// and the visitor's name can only come from the denormalised `PartnerRef`.
    func testVisitorPairingIsASingleEntryRow() {
        let entries = [Fx.entry(
            memberId: "member-a",
            status: .confirmed,
            partner: .visitor(visitorId: "v1", displayName: "Bob Visitor"),
            pairingId: "p1"
        )]
        let rows = Roster.buildPairs(entries: entries, nameOf: Fx.nameOf)
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].aName, "Jane Doe")
        XCTAssertEqual(rows[0].bName, "Bob Visitor")
        XCTAssertNil(rows[0].bMemberId)
        XCTAssertTrue(rows[0].isVisitor)
    }

    /// I4: the covered member is `substituted`; the remaining one carries
    /// `partnerSubstitute`.
    func testSubstitutedPairingAnnotatesWhoIsStandingInForWhom() {
        let entries = [
            Fx.entry(id: "e-remaining", memberId: "member-a", status: .confirmed,
                     partner: .member(memberId: "member-b", displayName: "John Smith"),
                     pairingId: "p1",
                     partnerSubstitute: .member(memberId: "member-c", displayName: "Amy Lee")),
            Fx.entry(id: "e-covered", memberId: "member-b", status: .substituted,
                     partner: .member(memberId: "member-a", displayName: "Jane Doe"),
                     pairingId: "p1",
                     substitute: .member(memberId: "member-c", displayName: "Amy Lee")),
        ]
        let rows = Roster.buildPairs(entries: entries, nameOf: Fx.nameOf)
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].aName, "Jane Doe")
        XCTAssertEqual(rows[0].bName, "John Smith")
        XCTAssertEqual(rows[0].substitute?.name, "Amy Lee")
        XCTAssertEqual(rows[0].substitute?.coveredName, "John Smith")
    }

    func testCancelledAndTeamEntriesAreExcluded() {
        var entries = pair("member-a", "member-b", pairingId: "p1")
        entries.append(Fx.entry(id: "e-cancelled", memberId: "member-c", status: .cancelled, pairingId: "p2"))
        entries.append(Fx.entry(id: "e-team", memberId: "member-d", status: .confirmed, pairingId: nil, teamId: "t1"))
        let rows = Roster.buildPairs(entries: entries, nameOf: Fx.nameOf)
        XCTAssertEqual(rows.count, 1)
    }

    /// A stand-in has their own `confirmed` entry; it must not appear as a
    /// pair of its own on top of the row it is already annotating.
    func testSubstitutesOwnEntryIsNotAPairRow() {
        let entries = [
            Fx.entry(id: "e-sub", memberId: "member-c", status: .confirmed,
                     partner: .member(memberId: "member-a", displayName: "Jane Doe"),
                     pairingId: "p1", isSubstituteFor: "member-b"),
        ]
        XCTAssertTrue(Roster.buildPairs(entries: entries, nameOf: Fx.nameOf).isEmpty)
    }

    func testPairsAreSortedByFirstName() {
        var entries = pair("member-a", "member-b", pairingId: "p1")  // Jane Doe
        entries += pair("member-c", "member-d", pairingId: "p2")     // Amy Lee
        let rows = Roster.buildPairs(entries: entries, nameOf: Fx.nameOf)
        XCTAssertEqual(rows.map(\.aName), ["Amy Lee", "Jane Doe"])
    }

    func testSoloRowsCarryTheirNoteAndSortByName() {
        let entries = [
            Fx.entry(id: "e1", memberId: "member-b", status: .lookingForPartner),
            Fx.entry(id: "e2", memberId: "member-c", status: .lookingForPartner, note: "Any grade"),
            Fx.entry(id: "e3", memberId: "member-d", status: .available),
        ]
        let lfp = Roster.buildSoloRows(entries: entries, status: .lookingForPartner, nameOf: Fx.nameOf)
        XCTAssertEqual(lfp.map(\.name), ["Amy Lee", "John Smith"])
        XCTAssertEqual(lfp.first?.note, "Any grade")
        XCTAssertEqual(Roster.buildSoloRows(entries: entries, status: .available, nameOf: Fx.nameOf).count, 1)
    }

    /// An `unavailable` entry is the member's private "don't offer me this"
    /// marker — it never appears under either noticeboard heading.
    func testUnavailableEntriesNeverAppearOnTheNoticeboard() {
        let entries = [
            Fx.entry(id: "e1", memberId: "member-b", status: .unavailable),
            Fx.entry(id: "e2", memberId: "member-c", status: .available),
        ]
        XCTAssertTrue(Roster.buildSoloRows(entries: entries, status: .lookingForPartner, nameOf: Fx.nameOf).isEmpty)
        XCTAssertEqual(
            Roster.buildSoloRows(entries: entries, status: .available, nameOf: Fx.nameOf).map(\.name),
            ["Amy Lee"]
        )
    }

    func testNoticeboardLabelsReadDifferentlyForTeams() {
        XCTAssertEqual(Roster.noticeboardLabels(format: .teams).lfp, "Looking for a team")
        XCTAssertEqual(Roster.noticeboardLabels(format: .teams).available, "Available for a team")
        XCTAssertEqual(Roster.noticeboardLabels(format: .pairs).lfp, "Looking for a partner")
        XCTAssertEqual(Roster.noticeboardLabels(format: nil).available, "Available")
    }

    // MARK: - describeOwnEntry

    func testDescribeOwnEntryForEachState() {
        let team = Fx.team()
        XCTAssertEqual(
            Roster.describeOwnEntry(Fx.entry(status: .confirmed, teamId: team.id), teams: [team]),
            "You: on team \"Doe team\""
        )
        XCTAssertEqual(
            Roster.describeOwnEntry(Fx.entry(status: .confirmed, teamId: "unknown"), teams: []),
            "You: on a team for this series"
        )
        XCTAssertEqual(
            Roster.describeOwnEntry(Fx.entry(
                status: .confirmed,
                partner: .member(memberId: "member-b", displayName: "John Smith")
            ), teams: []),
            "You: confirmed with John Smith"
        )
        XCTAssertEqual(
            Roster.describeOwnEntry(Fx.entry(
                status: .confirmed,
                partner: .visitor(visitorId: "v1", displayName: "Bob Visitor")
            ), teams: []),
            "You: confirmed with Bob Visitor (visitor)"
        )
        XCTAssertEqual(
            Roster.describeOwnEntry(Fx.entry(
                status: .confirmed,
                partner: .member(memberId: "member-b", displayName: "John Smith"),
                partnerSubstitute: .member(memberId: "member-c", displayName: "Amy Lee")
            ), teams: []),
            "You: confirmed with John Smith (sub this week: Amy Lee)"
        )
        XCTAssertEqual(
            Roster.describeOwnEntry(Fx.entry(
                status: .substituted,
                partner: .member(memberId: "member-b", displayName: "John Smith"),
                substitute: .member(memberId: "member-c", displayName: "Amy Lee")
            ), teams: []),
            "You: substituted this week by Amy Lee"
        )
        XCTAssertEqual(
            Roster.describeOwnEntry(Fx.entry(status: .lookingForPartner), teams: []),
            "You're looking for a partner."
        )
        XCTAssertEqual(
            Roster.describeOwnEntry(Fx.entry(status: .available), teams: []),
            "You're marked as available."
        )
        XCTAssertEqual(
            Roster.describeOwnEntry(Fx.entry(status: .unavailable), teams: []),
            "You've marked yourself unavailable for this session."
        )
        XCTAssertNil(Roster.describeOwnEntry(Fx.entry(status: .cancelled), teams: []))
    }
}

final class CardLogicTests: XCTestCase {

    func testStatusTextForEachShape() {
        XCTAssertEqual(
            CardLogic.describeStatus(Fx.entry(
                status: .confirmed,
                partner: .member(memberId: "member-b", displayName: "John Smith")
            )),
            "with John Smith"
        )
        XCTAssertEqual(
            CardLogic.describeStatus(Fx.entry(
                status: .confirmed,
                partner: .visitor(visitorId: "v1", displayName: "Bob Visitor")
            )),
            "with Bob Visitor (visitor)"
        )
        XCTAssertEqual(
            CardLogic.describeStatus(Fx.entry(
                status: .confirmed,
                partner: .member(memberId: "member-b", displayName: "John Smith"),
                partnerSubstitute: .member(memberId: "member-c", displayName: "Amy Lee")
            )),
            "with John Smith — sub: Amy Lee for John Smith"
        )
        XCTAssertEqual(
            CardLogic.describeStatus(Fx.entry(
                status: .substituted,
                partner: .member(memberId: "member-b", displayName: "John Smith"),
                substitute: .member(memberId: "member-c", displayName: "Amy Lee")
            )),
            "with John Smith — you're covered by Amy Lee"
        )
        XCTAssertEqual(CardLogic.describeStatus(Fx.entry(status: .lookingForPartner)), "Looking for a partner")
        XCTAssertEqual(CardLogic.describeStatus(Fx.entry(status: .available)), "Available")
    }

    func testTeamEntryShowsTheTeamName() {
        let team = Fx.team()
        XCTAssertEqual(
            CardLogic.describeStatus(Fx.entry(status: .confirmed, teamId: team.id), teams: [team]),
            "Doe team"
        )
        XCTAssertEqual(
            CardLogic.describeStatus(Fx.entry(status: .confirmed, teamId: "unknown"), teams: []),
            "On a team"
        )
    }

    func testGroupingIsByWeekdayThenSeriesWithRowsInDateOrder() {
        let entries = [
            Fx.entry(id: "e2", sessionId: "\(Fx.seriesId)-2027-01-18", date: "2027-01-18", status: .lookingForPartner),
            Fx.entry(id: "e1", sessionId: "\(Fx.seriesId)-2027-01-11", date: "2027-01-11", status: .lookingForPartner),
        ]
        let groups = CardLogic.groupEntries(
            entries: entries,
            sessions: [Fx.session(), Fx.session(id: "\(Fx.seriesId)-2027-01-18", date: "2027-01-18")],
            series: [Fx.series()],
            weekdays: [Fx.weekday()]
        )
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups[0].label, "Monday Afternoon")
        XCTAssertEqual(groups[0].groups.count, 1)
        XCTAssertEqual(groups[0].groups[0].title, "Marion Taylor Pairs")
        XCTAssertEqual(groups[0].groups[0].rows.map(\.date), ["2027-01-11", "2027-01-18"])
    }

    /// Plan §21 B3: the same `seriesId` exists in two published years. Each
    /// entry must group under, and be titled by, *its own* year's series.
    func testSeriesIdsAreResolvedWithinTheEntrysOwnYear() {
        let entries = [
            Fx.entry(id: "e1", sessionId: "\(Fx.seriesId)-2026-11-02", date: "2026-11-02", status: .lookingForPartner),
            Fx.entry(id: "e2", sessionId: Fx.sessionId, date: "2027-01-11", status: .lookingForPartner),
        ]
        let groups = CardLogic.groupEntries(
            entries: entries,
            sessions: [
                Fx.session(id: "\(Fx.seriesId)-2026-11-02", date: "2026-11-02", title: "Old Name"),
                Fx.session(),
            ],
            series: [Fx.series(name: "New Name", year: 2027), Fx.series(name: "Old Name", year: 2026)],
            weekdays: [Fx.weekday(year: 2027), Fx.weekday(label: "Monday (2026)", year: 2026)]
        )
        let flat = groups.flatMap(\.groups)
        XCTAssertEqual(flat.count, 2, "same seriesId in two years must not merge")
        XCTAssertEqual(Set(flat.map(\.title)), ["Old Name", "New Name"])
        XCTAssertEqual(flat.map { $0.rows.map(\.date) }.sorted { $0[0] < $1[0] },
                       [["2026-11-02"], ["2027-01-11"]])
    }

    /// As on the web, an `unavailable` marker is not a card line — the card
    /// lists what you're playing or seeking, and the Calendar shows the rest.
    func testUnavailableEntriesAreNotCardRows() {
        let groups = CardLogic.groupEntries(
            entries: [Fx.entry(status: .unavailable)],
            sessions: [Fx.session()], series: [Fx.series()], weekdays: [Fx.weekday()]
        )
        XCTAssertTrue(groups.isEmpty)
        XCTAssertTrue(CardLogic.pastRows(entries: [Fx.entry(status: .unavailable)], sessions: [], series: []).isEmpty)
    }

    func testCancelledEntriesAreDropped() {
        let groups = CardLogic.groupEntries(
            entries: [Fx.entry(status: .cancelled)],
            sessions: [Fx.session()],
            series: [Fx.series()],
            weekdays: [Fx.weekday()]
        )
        XCTAssertTrue(groups.isEmpty)
    }

    func testStandaloneSessionsGetTheirOwnGroupKeyedBySessionId() {
        let single = Fx.session(id: "2027-2027-06-01-tuesday", date: "2027-06-01",
                                seriesId: nil, kind: .holidayBridge, title: "Holiday Bridge")
        let groups = CardLogic.groupEntries(
            entries: [Fx.entry(id: "e1", sessionId: single.id, date: single.date, seriesId: nil,
                               status: .lookingForPartner)],
            sessions: [single],
            series: [],
            weekdays: [Fx.weekday()]
        )
        XCTAssertEqual(groups[0].groups[0].key, "single:\(single.id)")
        XCTAssertEqual(groups[0].groups[0].title, "Holiday Bridge")
    }

    func testPastRowsAreMostRecentFirst() {
        let rows = CardLogic.pastRows(
            entries: [
                Fx.entry(id: "e1", date: "2027-01-11", status: .lookingForPartner),
                Fx.entry(id: "e2", date: "2027-01-18", status: .lookingForPartner),
            ],
            sessions: [],
            series: [Fx.series()]
        )
        XCTAssertEqual(rows.map(\.date), ["2027-01-18", "2027-01-11"])
    }

    func testTeamRowsAreFlagged() {
        let team = Fx.team()
        let rows = CardLogic.pastRows(
            entries: [Fx.entry(status: .confirmed, teamId: team.id)],
            sessions: [Fx.session()],
            series: [Fx.series()],
            teams: [team]
        )
        XCTAssertTrue(rows[0].isTeam)
    }
}

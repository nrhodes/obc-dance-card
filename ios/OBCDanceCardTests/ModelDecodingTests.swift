//
//  ModelDecodingTests.swift
//  The `Codable` mirrors in `Shared/Models.swift` are hand-maintained against
//  `shared/src/models.ts`, so the risk they carry is *drift*: a field renamed
//  or an enum value changed on the server that this build silently stops
//  seeing. These tests decode literal document JSON in exactly the shape the
//  Cloud Functions write, so a rename fails here rather than in front of a
//  member.
//
//  They also pin the two deliberate leniencies: a document written before a
//  field existed still decodes, and an unrecognised notification type
//  degrades rather than poisoning the whole feed.
//

import XCTest
@testable import OBCDanceCard

final class ModelDecodingTests: XCTestCase {

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    // MARK: - Entry

    func testEntryDecodesAFullyPopulatedDocument() throws {
        let entry = try decode(Entry.self, """
        {
          "id": "monday-mtp-2027-01-11_member-a",
          "sessionId": "monday-mtp-2027-01-11",
          "date": "2027-01-11",
          "weekday": "monday",
          "seriesId": "monday-mtp",
          "memberId": "member-a",
          "status": "substituted",
          "partner": { "kind": "member", "memberId": "member-b", "displayName": "John Smith" },
          "pairingId": "p1",
          "teamId": null,
          "teamSessionOnly": false,
          "substitute": { "kind": "visitor", "visitorId": "v1", "displayName": "Bob Visitor" },
          "partnerSubstitute": null,
          "isSubstituteFor": null,
          "note": "running late",
          "createdBy": "member-a",
          "createdAt": "2027-01-01T00:00:00.000Z",
          "updatedAt": "2027-01-02T00:00:00.000Z"
        }
        """)

        XCTAssertEqual(entry.status, .substituted)
        XCTAssertEqual(entry.partner, .member(memberId: "member-b", displayName: "John Smith"))
        XCTAssertEqual(entry.substitute, .visitor(visitorId: "v1", displayName: "Bob Visitor"))
        XCTAssertNil(entry.teamId)
        XCTAssertEqual(entry.note, "running late")
        XCTAssertEqual(entry.year, 2027)
    }

    /// `looking_for_partner` is the one snake_cased status; a mismatch here
    /// would make every noticeboard row disappear.
    func testEntryStatusRawValuesMatchTheSharedVocabulary() throws {
        let statuses = ["confirmed", "looking_for_partner", "available", "unavailable", "substituted", "cancelled"]
        for raw in statuses {
            XCTAssertNotNil(EntryStatus(rawValue: raw), "missing EntryStatus for \(raw)")
        }
        XCTAssertEqual(EntryStatus.lookingForPartner.rawValue, "looking_for_partner")
    }

    /// Plan §21 B2: `unavailable` is solo (clears with `clearSoloStatus`) but
    /// not active (never a noticeboard listing).
    func testUnavailableIsSoloButNotActive() {
        XCTAssertTrue(EntryStatus.solo.contains(.unavailable))
        XCTAssertFalse(EntryStatus.active.contains(.unavailable))
        XCTAssertEqual(SoloStatus(rawValue: "unavailable"), .unavailable)
        XCTAssertEqual(BulkAvailabilityStatus.clear.rawValue, "clear")
    }

    func testEntryToleratesAnAbsentTeamSessionOnlyFlag() throws {
        let entry = try decode(Entry.self, """
        { "id": "e1", "sessionId": "s1", "date": "2027-01-11", "weekday": "monday",
          "memberId": "member-a", "status": "confirmed" }
        """)
        XCTAssertFalse(entry.teamSessionOnly)
        XCTAssertNil(entry.pairingId)
    }

    // MARK: - PartnerRef

    func testPartnerRefRoundTrips() throws {
        for ref in [
            PartnerRef.member(memberId: "m1", displayName: "Jane Doe"),
            PartnerRef.visitor(visitorId: "v1", displayName: "Bob Visitor"),
        ] {
            let data = try JSONEncoder().encode(ref)
            XCTAssertEqual(try JSONDecoder().decode(PartnerRef.self, from: data), ref)
        }
    }

    // MARK: - Member / MemberPrivate

    func testMemberDecodes() throws {
        let member = try decode(Member.self, """
        { "id": "member-a", "firstName": "Jane", "lastName": "Doe", "phone": "09 555 1234",
          "grade": "Intermediate", "role": "member", "active": true,
          "createdAt": "2027-01-01T00:00:00.000Z", "updatedAt": "2027-01-01T00:00:00.000Z" }
        """)
        XCTAssertEqual(member.fullName, "Jane Doe")
        XCTAssertEqual(member.grade, .intermediate)
        XCTAssertTrue(member.active)
        // Plan §8.1: absent before the backfill → `club`, never `review`.
        XCTAssertEqual(member.cohort, .club)
    }

    func testCohortDecodesOnMembersEntriesAndTeams() throws {
        let reviewer = try decode(Member.self, """
        { "id": "r1", "firstName": "App", "lastName": "Reviewer", "grade": "Open",
          "role": "member", "active": true, "cohort": "review" }
        """)
        XCTAssertEqual(reviewer.cohort, .review)
        let entry = try decode(Entry.self, """
        { "id": "e1", "sessionId": "s1", "date": "2027-01-11", "weekday": "monday",
          "memberId": "r1", "status": "confirmed", "cohort": "review" }
        """)
        XCTAssertEqual(entry.cohort, .review)
        let team = try decode(Team.self, """
        { "id": "t", "year": 2027, "seriesId": "s", "name": "N", "captainMemberId": "r1",
          "members": [], "status": "forming", "cohort": "club" }
        """)
        XCTAssertEqual(team.cohort, .club)
    }

    func testMemberPrivateFallsBackToTheDefaultPreferences() throws {
        let priv = try decode(MemberPrivate.self, """
        { "id": "member-a", "emailLower": "jane@example.org", "devices": [], "hasPassword": false }
        """)
        XCTAssertEqual(priv.notificationPrefs, NotificationPrefs.defaults)
        XCTAssertFalse(priv.hasPassword)
    }

    func testMemberPrivateDecodesPreferencesAndDevices() throws {
        let priv = try decode(MemberPrivate.self, """
        { "id": "member-a", "emailLower": "jane@example.org", "hasPassword": true,
          "notificationPrefs": { "push": false, "email": true, "reminders": true,
            "matchmakingAlerts": true, "digest": "daily", "reminderDaysBefore": 3 },
          "devices": [ { "token": "tok", "platform": "ios", "label": "iPhone",
                         "lastSeenAt": "2027-01-01T00:00:00.000Z" } ] }
        """)
        XCTAssertNil(priv.icalToken)
        XCTAssertEqual(priv.notificationPrefs.digest, .daily)
        XCTAssertEqual(priv.notificationPrefs.reminderDaysBefore, 3)
        XCTAssertFalse(priv.notificationPrefs.push)
        XCTAssertEqual(priv.devices.first?.platform, .ios)
    }

    func testMemberPrivateDecodesTheIcalTokenFields() throws {
        let priv = try decode(MemberPrivate.self, """
        { "id": "member-a", "emailLower": "jane@example.org", "devices": [], "hasPassword": true,
          "icalToken": "abc", "icalTokenCreatedAt": "2027-01-01T00:00:00.000Z" }
        """)
        XCTAssertEqual(priv.icalToken, "abc")
        XCTAssertEqual(priv.icalTokenCreatedAt, "2027-01-01T00:00:00.000Z")
    }

    // MARK: - Programme

    /// `year` is never stored on a series/weekday doc (it's the parent path);
    /// the store tags it after decoding, so a decode must default it.
    func testSeriesAndWeekdayYearDefaultToZeroWhenNotStored() throws {
        let series = try decode(Series.self, """
        { "id": "s", "weekday": "monday", "name": "N", "scoring": "Scr", "format": "Pairs",
          "allowSubstitute": true, "order": 0, "sessionIds": [] }
        """)
        XCTAssertEqual(series.year, 0)
        let weekday = try decode(WeekdayProgramme.self, """
        { "id": "monday", "weekday": "monday", "label": "Monday", "startTime": "13:00",
          "seatedByTime": "12:45" }
        """)
        XCTAssertEqual(weekday.year, 0)
    }

    func testSeriesDefaultsTeamBoundsWhenAbsent() throws {
        let series = try decode(Series.self, """
        { "id": "monday-mtp", "weekday": "monday", "name": "Marion Taylor Pairs",
          "scoring": "Scr", "format": "Pairs", "bestOf": null, "allowSubstitute": true,
          "order": 0, "sessionIds": ["a", "b"] }
        """)
        XCTAssertEqual(series.teamMin, 4)
        XCTAssertEqual(series.teamMax, 6)
        XCTAssertNil(series.bestOf)
        XCTAssertEqual(series.sessionIds.count, 2)
    }

    func testSeriesDecodesBestOf() throws {
        let series = try decode(Series.self, """
        { "id": "s", "weekday": "friday", "name": "N", "scoring": "Hcp", "format": "Teams",
          "bestOf": { "n": 3, "m": 4 }, "allowSubstitute": false, "order": 2,
          "sessionIds": [], "teamMin": 4, "teamMax": 5 }
        """)
        XCTAssertEqual(series.bestOf, BestOf(n: 3, m: 4))
        XCTAssertEqual(series.scoring, .handicap)
        XCTAssertEqual(series.format, .teams)
        XCTAssertEqual(series.teamMax, 5)
    }

    func testSessionDecodesAndComputesBookable() throws {
        let session = try decode(Session.self, """
        { "id": "2027-2027-06-07-monday", "date": "2027-06-07", "weekday": "monday",
          "seriesId": null, "kind": "noBridge", "title": "Queen's Birthday",
          "partnerRequired": false }
        """)
        XCTAssertEqual(session.kind, .noBridge)
        XCTAssertNil(session.seriesId)
        // `bookable` is computed, never stored (plan §5.4).
        XCTAssertFalse(session.isBookable(today: "2027-01-01"))
        let future = try decode(Session.self, """
        { "id": "s", "date": "2027-06-07", "weekday": "monday", "kind": "series",
          "title": "T", "partnerRequired": true }
        """)
        XCTAssertTrue(future.isBookable(today: "2027-01-01"))
        XCTAssertFalse(future.isBookable(today: "2027-12-01"))
    }

    // MARK: - Invite

    func testInviteDecodesATeamCaptaincyOffer() throws {
        let invite = try decode(Invite.self, """
        { "id": "i1", "scope": "team", "kind": "captaincy", "year": 2027, "sessionIds": [],
          "seriesId": "monday-ccc", "teamId": "t1", "fromMemberId": "member-a",
          "toMemberId": "member-b", "status": "pending", "createdBy": "member-a",
          "expiresAt": "2027-01-08T00:00:00.000Z",
          "createdAt": "2027-01-01T00:00:00.000Z", "updatedAt": "2027-01-01T00:00:00.000Z" }
        """)
        XCTAssertEqual(invite.scope, .team)
        XCTAssertEqual(invite.kind, .captaincy)
        XCTAssertEqual(invite.teamId, "t1")
    }

    /// An invite created before `kind` existed is implicitly a join invite —
    /// absent, not `"join"` (plan §5.7).
    func testInviteKindIsAbsentOnANonTeamInvite() throws {
        let invite = try decode(Invite.self, """
        { "id": "i2", "scope": "series", "year": 2027, "sessionIds": ["a", "b", "c"],
          "seriesId": "monday-mtp", "teamId": null, "fromMemberId": "member-a",
          "toMemberId": "member-b", "status": "pending", "expiresAt": "2027-01-08T00:00:00.000Z",
          "message": "Fancy a game?" }
        """)
        XCTAssertNil(invite.kind)
        XCTAssertEqual(invite.sessionIds.count, 3)
        XCTAssertEqual(invite.message, "Fancy a game?")
    }

    // MARK: - Notification

    func testNotificationDecodesItsDeepLinkData() throws {
        let notification = try decode(AppNotification.self, """
        { "id": "n1", "memberId": "member-a", "type": "invite_received",
          "title": "New invite", "body": "John Smith invited you",
          "data": { "inviteId": "i1" }, "channelsSent": ["inapp", "push"],
          "read": false, "createdAt": "2027-01-01T00:00:00.000Z" }
        """)
        XCTAssertEqual(notification.type, .inviteReceived)
        XCTAssertEqual(notification.data["inviteId"], "i1")
        XCTAssertEqual(notification.channelsSent, [.inapp, .push])
        XCTAssertFalse(notification.read)
    }

    /// A type this build predates must still render its title and body.
    func testUnknownNotificationTypeDegradesInsteadOfFailing() throws {
        let notification = try decode(AppNotification.self, """
        { "id": "n2", "memberId": "member-a", "type": "some_future_type",
          "title": "Heads up", "body": "Something new", "data": {},
          "channelsSent": [], "read": true }
        """)
        XCTAssertEqual(notification.type, .unrecognised)
        XCTAssertEqual(notification.title, "Heads up")
    }

    // MARK: - Team

    func testTeamDecodesRosterAndSessionVisitors() throws {
        let team = try decode(Team.self, """
        { "id": "monday-ccc-member-a", "year": 2027, "seriesId": "monday-ccc",
          "name": "Doe team", "captainMemberId": "member-a",
          "members": [
            { "ref": { "kind": "member", "memberId": "member-a", "displayName": "Jane Doe" },
              "joinedAt": "2027-01-01T00:00:00.000Z" },
            { "ref": { "kind": "visitor", "visitorId": "v1", "displayName": "Bob Visitor" },
              "joinedAt": "2027-01-02T00:00:00.000Z" }
          ],
          "status": "active",
          "sessionVisitors": {
            "monday-ccc-2027-01-11": [
              { "kind": "visitor", "visitorId": "v2", "displayName": "Sue Sub" }
            ]
          } }
        """)
        XCTAssertEqual(team.status, .active)
        XCTAssertEqual(team.members.count, 2)
        XCTAssertEqual(team.rosterMemberIds, ["member-a"]) // visitors excluded
        XCTAssertEqual(team.sessionVisitors?["monday-ccc-2027-01-11"]?.first?.displayName, "Sue Sub")
    }

    func testTeamToleratesAnAbsentSessionVisitorsField() throws {
        let team = try decode(Team.self, """
        { "id": "t", "year": 2027, "seriesId": "s", "name": "N",
          "captainMemberId": "member-a", "members": [], "status": "forming" }
        """)
        XCTAssertNil(team.sessionVisitors)
    }

    // MARK: - Visitor

    func testVisitorDecodesIncludingThePromotionMarker() throws {
        let visitor = try decode(Visitor.self, """
        { "id": "v1", "displayName": "Bob Visitor", "email": "bob@example.org",
          "createdByMemberId": "member-a", "courtesyEmails": true,
          "lastUsedAt": "2027-01-01T00:00:00.000Z", "promotedToMemberId": "member-z" }
        """)
        XCTAssertEqual(visitor.displayName, "Bob Visitor")
        XCTAssertTrue(visitor.courtesyEmails)
        XCTAssertEqual(visitor.promotedToMemberId, "member-z")
    }
}

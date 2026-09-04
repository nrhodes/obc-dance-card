//
//  Fixtures.swift
//  Builders mirroring the ones in the web suite's `lib/*.test.ts`, so the
//  Swift tests exercise the same shapes with the same ids and names and a
//  failure is directly comparable across the two clients.
//

import Foundation
@testable import OBCDanceCard

enum Fx {
    static let seriesId = "monday-marion-taylor-pairs"
    static let sessionId = "monday-marion-taylor-pairs-2027-01-11"
    static let teamsSeriesId = "monday-campbell-cave-teams"

    static func weekday(
        startTime: String = "13:00",
        label: String = "Monday Afternoon",
        year: Int = 2027
    ) -> WeekdayProgramme {
        WeekdayProgramme(
            id: "monday",
            weekday: .monday,
            label: label,
            startTime: startTime,
            seatedByTime: "12:45",
            year: year
        )
    }

    static func session(
        id: String = sessionId,
        date: String = "2027-01-11",
        seriesId: String? = seriesId,
        kind: SessionKind = .series,
        title: String = "Marion Taylor Pairs",
        format: SeriesFormat? = .pairs
    ) -> Session {
        Session(
            id: id,
            date: date,
            weekday: .monday,
            seriesId: seriesId,
            kind: kind,
            title: title,
            partnerRequired: true,
            format: format
        )
    }

    static func series(
        id: String = seriesId,
        name: String = "Marion Taylor Pairs",
        format: SeriesFormat = .pairs,
        allowSubstitute: Bool = true,
        order: Int = 0,
        sessionIds: [String] = [],
        teamMin: Int = 4,
        teamMax: Int = 6,
        year: Int = 2027
    ) -> Series {
        Series(
            id: id,
            weekday: .monday,
            name: name,
            format: format,
            allowSubstitute: allowSubstitute,
            order: order,
            sessionIds: sessionIds,
            teamMin: teamMin,
            teamMax: teamMax,
            year: year
        )
    }

    static func entry(
        id: String = "e1",
        sessionId: String = sessionId,
        date: String = "2027-01-11",
        seriesId: String? = seriesId,
        memberId: String = "member-a",
        status: EntryStatus = .confirmed,
        partner: PartnerRef? = nil,
        pairingId: String? = nil,
        teamId: String? = nil,
        teamSessionOnly: Bool = false,
        substitute: PartnerRef? = nil,
        partnerSubstitute: PartnerRef? = nil,
        isSubstituteFor: String? = nil,
        note: String? = nil
    ) -> Entry {
        Entry(
            id: id,
            sessionId: sessionId,
            date: date,
            weekday: .monday,
            seriesId: seriesId,
            memberId: memberId,
            status: status,
            partner: partner,
            pairingId: pairingId,
            teamId: teamId,
            teamSessionOnly: teamSessionOnly,
            substitute: substitute,
            partnerSubstitute: partnerSubstitute,
            isSubstituteFor: isSubstituteFor,
            note: note
        )
    }

    static func team(
        id: String = "monday-campbell-cave-teams-member-a",
        seriesId: String = teamsSeriesId,
        name: String = "Doe team",
        captainMemberId: String = "member-a",
        members: [PartnerRef] = [
            .member(memberId: "member-a", displayName: "Jane Doe"),
            .member(memberId: "member-b", displayName: "John Smith"),
        ],
        status: TeamStatus = .forming,
        sessionVisitors: [String: [PartnerRef]]? = nil
    ) -> Team {
        Team(
            id: id,
            year: 2027,
            seriesId: seriesId,
            name: name,
            captainMemberId: captainMemberId,
            members: members.map { TeamMemberEntry(ref: $0, joinedAt: "") },
            status: status,
            sessionVisitors: sessionVisitors
        )
    }

    static func member(
        id: String,
        first: String,
        last: String,
        grade: MemberGrade = .open
    ) -> Member {
        Member(id: id, firstName: first, lastName: last, grade: grade)
    }

    /// The directory lookup the roster/card helpers take, matching the web
    /// suite's `nameOf` stub (unknown ids read "A member").
    static func nameOf(_ memberId: String) -> String {
        switch memberId {
        case "member-a": return "Jane Doe"
        case "member-b": return "John Smith"
        case "member-c": return "Amy Lee"
        case "member-d": return "Bob Brown"
        default: return "A member"
        }
    }

    /// Parses an ISO-8601 instant for tests, e.g. `"2027-01-11T00:00:00Z"`.
    static func instant(_ iso: String) -> Date {
        guard let date = ISO8601DateFormatter().date(from: iso) else {
            preconditionFailure("bad test instant: \(iso)")
        }
        return date
    }

    /// Well before the 2027-01-11 13:00 NZDT cutoff (which is 2027-01-11T00:00Z).
    static let beforeCutoff = instant("2027-01-10T00:00:00Z")

    /// After it.
    static let afterCutoff = instant("2027-01-11T02:00:00Z")
}

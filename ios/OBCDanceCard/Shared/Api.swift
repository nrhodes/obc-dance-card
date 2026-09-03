//
//  Api.swift
//  One typed wrapper per callable this app invokes. Names must match the
//  deployed callables in `firebase/functions/src` (plan §9.2); the payload
//  shapes come from the zod schemas in `shared/src/schemas.ts`.
//
//  Two deliberate omissions, both from the plan rather than from laziness:
//
//   * **No admin callables.** iOS is a member-only client (plan §14.1/§14.2,
//     iOS brief): imports, roles, erasure, broadcast, audit log and the
//     pairing sweep are web-only.
//   * **No `onBehalfOfMemberId` / `force`.** Acting on behalf is admins only
//     (plan §2), so nothing here ever sends either field.
//
//  Optional fields are omitted rather than sent as null — see `payload(_:)`.
//

import Foundation

// MARK: - Result shapes (the subset the UI actually reads)

struct VerifyLoginCodeResult: Decodable {
    /// Firebase custom token for `signIn(withCustomToken:)`.
    let token: String
}

struct RespondToInviteResult: Decodable {
    /// True when accepting pairs the same two members again within an
    /// Individual series (plan §2). A warning, never a block.
    let repeatPartnerWarning: Bool?
}

struct ClaimResult: Decodable {
    /// Present when the claim joined the poster to the claimer's team.
    let team: Team?
    let repeatPartnerWarning: Bool?
}

struct CreateVisitorResult: Decodable {
    let visitor: Visitor
    /// Non-blocking warnings, e.g. a display-name collision (plan §12.6).
    let warnings: [String]
}

// MARK: - Callables

enum Api {

    // ---------------------------------------------------------------- auth

    /// Always resolves the same way whether or not the email is a known
    /// member (plan §8.2 step 2 — no enumeration).
    static func requestLoginCode(email: String) async throws {
        try await Callable.call("requestLoginCode", ["email": email])
    }

    static func verifyLoginCode(email: String, code: String) async throws -> VerifyLoginCodeResult {
        try await Callable.call("verifyLoginCode", ["email": email, "code": code],
                                as: VerifyLoginCodeResult.self)
    }

    /// Sets a password using the current session — no "sign in again" detour
    /// (plan §8.2, and an accessibility decision for elderly members).
    static func setPassword(_ password: String) async throws {
        try await Callable.call("setPassword", ["password": password])
    }

    /// Rotates the password to an unknowable value and clears `hasPassword`.
    /// Firebase cannot truly unset a password (plan §8.2).
    static func removePassword() async throws {
        try await Callable.call("removePassword", [:])
    }

    // ------------------------------------------------------------- profile

    static func updateMyContact(phone: String) async throws {
        try await Callable.call("updateMyContact", ["phone": phone])
    }

    static func updateMyPrefs(_ prefs: NotificationPrefs) async throws {
        try await Callable.call("updateMyPrefs", [
            "push": prefs.push,
            "email": prefs.email,
            "reminders": prefs.reminders,
            "matchmakingAlerts": prefs.matchmakingAlerts,
            "digest": prefs.digest.rawValue,
            "reminderDaysBefore": prefs.reminderDaysBefore,
        ])
    }

    // ---------------------------------------------------------------- push

    static func registerDevice(token: String, label: String?) async throws {
        try await Callable.call("registerDevice", payload([
            "token": token,
            "platform": DevicePlatform.ios.rawValue,
            "label": label,
        ]))
    }

    static func unregisterDevice(token: String) async throws {
        try await Callable.call("unregisterDevice", ["token": token])
    }

    // ------------------------------------------------------------- invites

    static func sendInvite(
        scope: InviteScope,
        year: Int,
        sessionId: String?,
        seriesId: String?,
        toMemberId: String,
        message: String?
    ) async throws {
        try await Callable.call("sendInvite", payload([
            "scope": scope.rawValue,
            "year": year,
            "toMemberId": toMemberId,
            // Only ever include the id that applies to this invite's scope.
            "sessionId": scope == .session ? sessionId : nil,
            "seriesId": scope == .series ? seriesId : nil,
            "message": message,
        ]))
    }

    @discardableResult
    static func respondToInvite(inviteId: String, accept: Bool) async throws -> RespondToInviteResult {
        try await Callable.call("respondToInvite", ["inviteId": inviteId, "accept": accept],
                                as: RespondToInviteResult.self)
    }

    static func cancelInvite(inviteId: String) async throws {
        try await Callable.call("cancelInvite", ["inviteId": inviteId])
    }

    // ------------------------------------------------------------- entries

    static func setSoloStatus(year: Int, sessionId: String, status: SoloStatus, note: String?) async throws {
        try await Callable.call("setSoloStatus", payload([
            "year": year,
            "sessionId": sessionId,
            "status": status.rawValue,
            "note": note,
        ]))
    }

    /// Withdraws a `looking_for_partner` / `available` listing. Deliberately
    /// has no on-behalf form server-side (plan §9.2 schema note).
    static func clearSoloStatus(year: Int, sessionId: String) async throws {
        try await Callable.call("clearSoloStatus", ["year": year, "sessionId": sessionId])
    }

    @discardableResult
    static func claimLookingForPartner(year: Int, sessionId: String, posterMemberId: String) async throws -> ClaimResult {
        try await Callable.call("claimLookingForPartner", [
            "year": year,
            "sessionId": sessionId,
            "posterMemberId": posterMemberId,
        ], as: ClaimResult.self)
    }

    static func cancelEntry(entryId: String) async throws {
        try await Callable.call("cancelEntry", ["entryId": entryId])
    }

    static func markNotificationsRead(ids: [String]) async throws {
        guard !ids.isEmpty else { return }
        // The schema caps a batch at 200 ids.
        for chunk in stride(from: 0, to: ids.count, by: 200) {
            let slice = Array(ids[chunk..<min(chunk + 200, ids.count)])
            try await Callable.call("markNotificationsRead", ["ids": slice])
        }
    }

    // ------------------------------------------------------------ visitors

    static func createVisitor(
        displayName: String,
        email: String?,
        phone: String?,
        notes: String?,
        courtesyEmails: Bool
    ) async throws -> CreateVisitorResult {
        try await Callable.call("createVisitor", payload([
            "displayName": displayName,
            "email": email,
            "phone": phone,
            "notes": notes,
            "courtesyEmails": courtesyEmails,
        ]), as: CreateVisitorResult.self)
    }

    static func updateVisitor(
        visitorId: String,
        displayName: String?,
        email: String?,
        phone: String?,
        notes: String?,
        courtesyEmails: Bool?
    ) async throws {
        try await Callable.call("updateVisitor", payload([
            "visitorId": visitorId,
            "displayName": displayName,
            "email": email,
            "phone": phone,
            "notes": notes,
            "courtesyEmails": courtesyEmails,
        ]))
    }

    static func deleteVisitor(visitorId: String) async throws {
        try await Callable.call("deleteVisitor", ["visitorId": visitorId])
    }

    static func signUpWithVisitor(
        scope: InviteScope,
        year: Int,
        sessionId: String?,
        seriesId: String?,
        visitorId: String
    ) async throws {
        try await Callable.call("signUpWithVisitor", payload([
            "scope": scope.rawValue,
            "year": year,
            "visitorId": visitorId,
            "sessionId": scope == .session ? sessionId : nil,
            "seriesId": scope == .series ? seriesId : nil,
        ]))
    }

    // --------------------------------------------------------- substitutes

    static func setSubstitute(entryId: String, substitute: PartnerRefInput, coverFor: CoverFor) async throws {
        try await Callable.call("setSubstitute", [
            "entryId": entryId,
            "substitute": substitute.payload,
            "coverFor": coverFor.rawValue,
        ])
    }

    static func clearSubstitute(entryId: String) async throws {
        try await Callable.call("clearSubstitute", ["entryId": entryId])
    }

    // --------------------------------------------------------------- teams

    static func createTeam(year: Int, seriesId: String, name: String?) async throws {
        try await Callable.call("createTeam", payload([
            "year": year,
            "seriesId": seriesId,
            "name": name,
        ]))
    }

    static func inviteToTeam(teamId: String, toMemberId: String, message: String?) async throws {
        try await Callable.call("inviteToTeam", payload([
            "teamId": teamId,
            "toMemberId": toMemberId,
            "message": message,
        ]))
    }

    static func addVisitorToTeam(teamId: String, visitorId: String) async throws {
        try await Callable.call("addVisitorToTeam", ["teamId": teamId, "visitorId": visitorId])
    }

    static func removeVisitorFromTeam(teamId: String, visitorId: String) async throws {
        try await Callable.call("removeVisitorFromTeam", ["teamId": teamId, "visitorId": visitorId])
    }

    static func leaveTeam(teamId: String) async throws {
        try await Callable.call("leaveTeam", ["teamId": teamId])
    }

    static func removeFromTeam(teamId: String, ref: PartnerRefInput) async throws {
        try await Callable.call("removeFromTeam", ["teamId": teamId, "ref": ref.payload])
    }

    /// Sends a `kind: 'captaincy'` invite — the captaincy only changes once
    /// the other member accepts (plan §9.2).
    static func transferCaptaincy(teamId: String, toMemberId: String) async throws {
        try await Callable.call("transferCaptaincy", ["teamId": teamId, "toMemberId": toMemberId])
    }

    static func disbandTeam(teamId: String) async throws {
        try await Callable.call("disbandTeam", ["teamId": teamId])
    }

    static func addTeamSessionSubstitute(teamId: String, sessionId: String, ref: PartnerRefInput) async throws {
        try await Callable.call("addTeamSessionSubstitute", [
            "teamId": teamId,
            "sessionId": sessionId,
            "ref": ref.payload,
        ])
    }

    static func clearTeamSessionSubstitute(teamId: String, sessionId: String, ref: PartnerRefInput) async throws {
        try await Callable.call("clearTeamSessionSubstitute", [
            "teamId": teamId,
            "sessionId": sessionId,
            "ref": ref.payload,
        ])
    }
}

//
//  MemberPicker.swift
//  Pure filter/sort for the "invite a partner" member picker — a 1:1 port of
//  `web/src/lib/memberPicker.ts`: search the members directory by name,
//  excluding the signed-in member and anyone already confirmed on this
//  session.
//

import Foundation

enum MemberPicker {
    static func filter(
        _ members: [Member],
        selfId: String,
        excludeMemberIds: Set<String>,
        query: String
    ) -> [Member] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return members
            .filter { $0.id != selfId && !excludeMemberIds.contains($0.id) }
            .filter { q.isEmpty || $0.fullName.lowercased().contains(q) }
            .sorted { $0.fullName.localizedCaseInsensitiveCompare($1.fullName) == .orderedAscending }
    }
}

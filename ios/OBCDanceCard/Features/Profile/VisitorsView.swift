//
//  VisitorsView.swift
//  "My visitors" (plan §12.1/§12.6) — the counterpart of
//  `web/src/screens/VisitorsScreen.tsx`. List, add, edit, delete. Every
//  mutation is a callable.
//
//  Two server behaviours are surfaced deliberately rather than smoothed over:
//  a name-collision warning from `createVisitor` shows as a non-blocking
//  notice, and a delete blocked by future entries shows the server's
//  `failed-precondition` message verbatim (it names the dates — plan §12.6).
//

import SwiftUI

struct VisitorsView: View {
    @EnvironmentObject private var visitorsStore: VisitorsStore

    @State private var adding = false
    @State private var editing: Visitor?
    @State private var deleteTarget: Visitor?
    @State private var notice: String?
    @State private var errorMessage: String?
    @State private var deleting = false

    var body: some View {
        List {
            if let notice {
                Section { Text(notice).foregroundStyle(.green) }
            }
            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(.red) }
            }
            if let error = visitorsStore.error {
                Section { Text(error.message).foregroundStyle(.secondary) }
            }

            Section {
                if visitorsStore.loading {
                    ProgressView()
                } else if visitorsStore.visitors.isEmpty {
                    Text("You haven't added any visitors yet.").foregroundStyle(.secondary)
                }
                ForEach(visitorsStore.visitors) { visitor in
                    row(visitor)
                }
            } footer: {
                Text("People who aren't members that you sponsor to play with. Only you and the club's admins can see their contact details.")
            }

            Section {
                Button("Add a visitor") { adding = true }
            }
        }
        .navigationTitle("My visitors")
        .sheet(isPresented: $adding) {
            VisitorFormSheet(title: "Add a visitor", submitLabel: "Add visitor") { values in
                await create(values)
            }
        }
        .sheet(item: $editing) { visitor in
            VisitorFormSheet(
                title: "Edit visitor",
                submitLabel: "Save",
                initial: VisitorFormValues(visitor)
            ) { values in
                await update(visitor, values)
            }
        }
        .alert("Delete this visitor?", isPresented: .constant(deleteTarget != nil), presenting: deleteTarget) { visitor in
            Button("Delete", role: .destructive) { Task { await delete(visitor) } }
            Button("Cancel", role: .cancel) { deleteTarget = nil }
        } message: { visitor in
            Text("\(visitor.displayName) will be removed from your visitors list.")
        }
    }

    @ViewBuilder
    private func row(_ visitor: Visitor) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(visitor.displayName).font(.body.weight(.medium))
                if visitor.promotedToMemberId != nil {
                    Text("now a member")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Color.secondary.opacity(0.15), in: Capsule())
                }
            }
            if let email = visitor.email, !email.isEmpty {
                Text(email).font(.subheadline).foregroundStyle(.secondary)
            }
            if let phone = visitor.phone, !phone.isEmpty {
                Text(phone).font(.subheadline).foregroundStyle(.secondary)
            }
            if let notes = visitor.notes, !notes.isEmpty {
                Text(notes).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
        .swipeActions(edge: .trailing) {
            Button("Delete", role: .destructive) { deleteTarget = visitor }
            Button("Edit") { editing = visitor }.tint(.blue)
        }
    }

    private func create(_ values: VisitorFormValues) async -> String? {
        let v = values.normalised
        do {
            let result = try await Api.createVisitor(
                displayName: v.displayName,
                email: v.email,
                phone: v.phone,
                notes: v.notes,
                courtesyEmails: v.courtesyEmails
            )
            errorMessage = nil
            notice = result.warnings.isEmpty
                ? "\(result.visitor.displayName) added."
                : result.warnings.joined(separator: " ")
            return nil
        } catch {
            return ErrorMapper.action(error)
        }
    }

    private func update(_ visitor: Visitor, _ values: VisitorFormValues) async -> String? {
        let v = values.normalised
        do {
            try await Api.updateVisitor(
                visitorId: visitor.id,
                displayName: v.displayName,
                email: v.email,
                phone: v.phone,
                notes: v.notes,
                courtesyEmails: v.courtesyEmails
            )
            errorMessage = nil
            notice = "Saved."
            return nil
        } catch {
            return ErrorMapper.action(error)
        }
    }

    private func delete(_ visitor: Visitor) async {
        deleting = true
        do {
            try await Api.deleteVisitor(visitorId: visitor.id)
            errorMessage = nil
            notice = "\(visitor.displayName) removed."
        } catch {
            notice = nil
            errorMessage = ErrorMapper.action(error)
        }
        deleting = false
        deleteTarget = nil
    }
}

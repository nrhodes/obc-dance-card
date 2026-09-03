//
//  Pickers.swift
//  The sheets shared between the session page, the team panel and Profile —
//  the Swift counterparts of the web app's `components/*Dialog.tsx`. Copy is
//  kept word-for-word with the web versions so a member who uses both clients
//  reads the same sentence in the same place.
//
//  Every one of these only *collects* input; the callable call itself stays
//  with the screen that owns the action, so error mapping and the busy state
//  live in one place per screen.
//

import SwiftUI

// MARK: - Visitor form

struct VisitorFormValues {
    var displayName: String = ""
    var email: String = ""
    var phone: String = ""
    var notes: String = ""
    var courtesyEmails: Bool = false

    var trimmedName: String { displayName.trimmingCharacters(in: .whitespacesAndNewlines) }
    var trimmedEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines) }

    init() {}

    init(_ visitor: Visitor) {
        displayName = visitor.displayName
        email = visitor.email ?? ""
        phone = visitor.phone ?? ""
        notes = visitor.notes ?? ""
        courtesyEmails = visitor.courtesyEmails
    }

    /// Trimmed, with empty optionals dropped — matching the web form, which
    /// omits a blank field rather than sending an empty string.
    var normalised: (displayName: String, email: String?, phone: String?, notes: String?, courtesyEmails: Bool) {
        let e = trimmedEmail.isEmpty ? nil : trimmedEmail
        let p = phone.trimmingCharacters(in: .whitespacesAndNewlines)
        let n = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        return (
            displayName: trimmedName,
            email: e,
            phone: p.isEmpty ? nil : p,
            notes: n.isEmpty ? nil : n,
            // "Send them a confirmation email" is meaningless without an
            // address, and plan §12.1 says it's off by default and only
            // available once an email is given.
            courtesyEmails: e == nil ? false : courtesyEmails
        )
    }
}

/// Add/edit visitor fields (plan §12.1). Used inline on "My visitors" and
/// inside the visitor pickers' "Add a new visitor" step.
struct VisitorFormFields: View {
    @Binding var values: VisitorFormValues

    var body: some View {
        Section("Visitor") {
            TextField("Name", text: $values.displayName)
                .textContentType(.name)
            TextField("Email (optional)", text: $values.email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onChange(of: values.email) { _, newValue in
                    if newValue.trimmingCharacters(in: .whitespaces).isEmpty {
                        values.courtesyEmails = false
                    }
                }
            TextField("Phone (optional)", text: $values.phone)
                .textContentType(.telephoneNumber)
                .keyboardType(.phonePad)
            TextField("Notes (optional)", text: $values.notes, axis: .vertical)
                .lineLimit(2...4)
            Toggle("Send them a confirmation email", isOn: $values.courtesyEmails)
                .disabled(values.trimmedEmail.isEmpty)
        }
    }
}

/// A standalone add/edit visitor sheet.
struct VisitorFormSheet: View {
    let title: String
    let submitLabel: String
    @State var values: VisitorFormValues
    let onSubmit: (VisitorFormValues) async -> String?

    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var errorMessage: String?

    init(
        title: String,
        submitLabel: String,
        initial: VisitorFormValues = VisitorFormValues(),
        onSubmit: @escaping (VisitorFormValues) async -> String?
    ) {
        self.title = title
        self.submitLabel = submitLabel
        _values = State(initialValue: initial)
        self.onSubmit = onSubmit
    }

    var body: some View {
        NavigationStack {
            Form {
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
                VisitorFormFields(values: $values)
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? "Saving…" : submitLabel) {
                        Task { await submit() }
                    }
                    .disabled(busy || values.trimmedName.isEmpty)
                }
            }
        }
    }

    private func submit() async {
        busy = true
        errorMessage = await onSubmit(values)
        busy = false
        if errorMessage == nil { dismiss() }
    }
}

// MARK: - Member picker

/// Searchable member list. `members` is the already-filtered candidate pool.
struct MemberPickerList: View {
    let members: [Member]
    let selfId: String
    let excludeMemberIds: Set<String>
    let onSelect: (Member) -> Void

    @State private var query = ""

    private var options: [Member] {
        MemberPicker.filter(members, selfId: selfId, excludeMemberIds: excludeMemberIds, query: query)
    }

    var body: some View {
        Section {
            TextField("Type a name…", text: $query)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .accessibilityLabel("Search members")
        }
        Section {
            if options.isEmpty {
                Text("No members found.").foregroundStyle(.secondary)
            }
            ForEach(options) { member in
                Button {
                    onSelect(member)
                } label: {
                    HStack {
                        Text(member.fullName)
                        Spacer()
                        Text(member.grade.rawValue)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// "Invite a partner" (plan Phase 3b): pick a member, then an optional
/// message and — for a series session — a "whole series" toggle.
struct InvitePartnerSheet: View {
    let members: [Member]
    let selfId: String
    let excludeMemberIds: Set<String>
    /// Number of sessions in this session's series, when it belongs to one.
    let seriesSessionCount: Int?
    let initialMember: Member?
    /// `(toMemberId, message, scope)`; returns a display-safe error, or nil.
    let onSubmit: (String, String?, InviteScope) async -> String?

    @Environment(\.dismiss) private var dismiss
    @State private var selected: Member?
    @State private var message = ""
    @State private var wholeSeries = false
    @State private var busy = false
    @State private var errorMessage: String?

    init(
        members: [Member],
        selfId: String,
        excludeMemberIds: Set<String>,
        seriesSessionCount: Int?,
        initialMember: Member? = nil,
        onSubmit: @escaping (String, String?, InviteScope) async -> String?
    ) {
        self.members = members
        self.selfId = selfId
        self.excludeMemberIds = excludeMemberIds
        self.seriesSessionCount = seriesSessionCount
        self.initialMember = initialMember
        self.onSubmit = onSubmit
        _selected = State(initialValue: initialMember)
    }

    var body: some View {
        NavigationStack {
            Form {
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
                if let selected {
                    Section("Message (optional)") {
                        TextField("Message", text: $message, axis: .vertical)
                            .lineLimit(3...5)
                            .accessibilityLabel("Message")
                    }
                    if let count = seriesSessionCount, count > 0 {
                        Section {
                            Toggle("Invite for the whole series (\(Fmt.pluralised(count, "session")))",
                                   isOn: $wholeSeries)
                        }
                    }
                    Section {
                        Button(busy ? "Sending…" : "Send invite") {
                            Task { await submit(selected) }
                        }
                        .disabled(busy)
                        if initialMember == nil {
                            Button("Choose someone else") { self.selected = nil }
                                .disabled(busy)
                        }
                    }
                } else {
                    MemberPickerList(
                        members: members,
                        selfId: selfId,
                        excludeMemberIds: excludeMemberIds
                    ) { selected = $0 }
                }
            }
            .navigationTitle(selected.map { "Invite \($0.fullName)" } ?? "Invite a partner")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(busy)
                }
            }
        }
    }

    private func submit(_ member: Member) async {
        busy = true
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        errorMessage = await onSubmit(
            member.id,
            trimmed.isEmpty ? nil : trimmed,
            wholeSeries ? .series : .session
        )
        busy = false
        if errorMessage == nil { dismiss() }
    }
}

/// Pick a member *or* one of the caller's visitors, to fill a `PartnerRef`
/// slot (`setSubstitute` / `addTeamSessionSubstitute`).
struct PartnerPickerSheet: View {
    let title: String
    let members: [Member]
    let visitors: [Visitor]
    let onSelect: (PartnerRefInput) async -> String?
    let onCreateVisitor: (VisitorFormValues) async -> Result<Visitor, AppError>

    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var addingVisitor = false

    var body: some View {
        NavigationStack {
            Form {
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
                MemberPickerList(members: members, selfId: "", excludeMemberIds: []) { member in
                    Task { await select(.member(memberId: member.id)) }
                }
                if !visitors.isEmpty {
                    Section("My visitors") {
                        ForEach(visitors) { visitor in
                            Button(visitor.displayName) {
                                Task { await select(.visitor(visitorId: visitor.id)) }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                Section {
                    Button("Add a new visitor") { addingVisitor = true }.disabled(busy)
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(busy)
                }
            }
            .sheet(isPresented: $addingVisitor) {
                VisitorFormSheet(title: "Add a new visitor", submitLabel: "Add and continue") { values in
                    switch await onCreateVisitor(values) {
                    case let .success(visitor):
                        let error = await onSelect(.visitor(visitorId: visitor.id))
                        if error == nil { dismiss() }
                        return error
                    case let .failure(error):
                        return error.message
                    }
                }
            }
        }
    }

    private func select(_ ref: PartnerRefInput) async {
        busy = true
        errorMessage = await onSelect(ref)
        busy = false
        if errorMessage == nil { dismiss() }
    }
}

/// Pick one of the member's visitors, or add one inline (plan §12.1/§12.2).
/// Used for "Play with a visitor" (with the optional whole-series toggle) and
/// a captain's "Add a visitor" (no toggle).
struct VisitorPickerSheet: View {
    let title: String
    let visitors: [Visitor]
    /// Non-nil shows the "whole series" toggle.
    let seriesSessionCount: Int?
    /// `(visitorId, wholeSeries)`; returns a display-safe error, or nil.
    let onSelect: (String, Bool) async -> String?
    let onCreateVisitor: (VisitorFormValues) async -> Result<Visitor, AppError>

    @Environment(\.dismiss) private var dismiss
    @State private var wholeSeries = false
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var addingVisitor = false

    var body: some View {
        NavigationStack {
            Form {
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
                if let count = seriesSessionCount, count > 0 {
                    Section {
                        Toggle("For the whole series (\(Fmt.pluralised(count, "session")))", isOn: $wholeSeries)
                            .disabled(busy)
                    }
                }
                Section {
                    if visitors.isEmpty {
                        Text("You have no visitors yet.").foregroundStyle(.secondary)
                    }
                    ForEach(visitors) { visitor in
                        Button(visitor.displayName) {
                            Task { await select(visitor.id) }
                        }
                        .buttonStyle(.plain)
                        .disabled(busy)
                    }
                }
                Section {
                    Button("Add a new visitor") { addingVisitor = true }.disabled(busy)
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(busy)
                }
            }
            .sheet(isPresented: $addingVisitor) {
                VisitorFormSheet(title: "Add a new visitor", submitLabel: "Add and continue") { values in
                    switch await onCreateVisitor(values) {
                    case let .success(visitor):
                        let error = await onSelect(visitor.id, wholeSeries)
                        if error == nil { dismiss() }
                        return error
                    case let .failure(error):
                        return error.message
                    }
                }
            }
        }
    }

    private func select(_ visitorId: String) async {
        busy = true
        errorMessage = await onSelect(visitorId, wholeSeries)
        busy = false
        if errorMessage == nil { dismiss() }
    }
}

/// "I'm looking for a partner" / "I'm available", with an optional short
/// note. A Teams series reads "team" instead of "partner" (plan §12A.4).
struct SoloStatusSheet: View {
    let status: SoloStatus
    let entityLabel: String
    let onSubmit: (String?) async -> String?

    @Environment(\.dismiss) private var dismiss
    @State private var note = ""
    @State private var busy = false
    @State private var errorMessage: String?

    private var title: String {
        switch (entityLabel, status) {
        case ("team", .lookingForPartner): return "I'm looking for a team"
        case ("team", .available): return "I'm available for a team"
        case (_, .lookingForPartner): return "I'm looking for a partner"
        case (_, .available): return "I'm available"
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
                Section("Note (optional)") {
                    TextField("Note", text: $note)
                        .accessibilityLabel("Note")
                }
                Section {
                    Button(busy ? "Saving…" : "Confirm") { Task { await submit() } }
                        .disabled(busy)
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(busy)
                }
            }
        }
    }

    private func submit() async {
        busy = true
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        errorMessage = await onSubmit(trimmed.isEmpty ? nil : trimmed)
        busy = false
        if errorMessage == nil { dismiss() }
    }
}

/// "Start a team" (plan §9.2 `createTeam`, §12A.2). The name is optional —
/// the server defaults it to "<captain surname> team".
struct StartTeamSheet: View {
    let onSubmit: (String?) async -> String?

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var busy = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
                Section("Team name (optional)") {
                    TextField("Team name", text: $name)
                }
                Section {
                    Button(busy ? "Starting…" : "Start team") { Task { await submit() } }
                        .disabled(busy)
                }
            }
            .navigationTitle("Start a team")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(busy)
                }
            }
        }
    }

    private func submit() async {
        busy = true
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        errorMessage = await onSubmit(trimmed.isEmpty ? nil : trimmed)
        busy = false
        if errorMessage == nil { dismiss() }
    }
}

/// A captain's "Invite a member" (plan §9.2 `inviteToTeam`, §12A.2).
struct InviteToTeamSheet: View {
    let members: [Member]
    let selfId: String
    let excludeMemberIds: Set<String>
    let onSubmit: (String, String?) async -> String?

    @Environment(\.dismiss) private var dismiss
    @State private var selected: Member?
    @State private var message = ""
    @State private var busy = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
                if let selected {
                    Section("Message (optional)") {
                        TextField("Message", text: $message, axis: .vertical).lineLimit(3...5)
                    }
                    Section {
                        Button(busy ? "Sending…" : "Send invite") { Task { await submit(selected) } }
                            .disabled(busy)
                        Button("Choose someone else") { self.selected = nil }.disabled(busy)
                    }
                } else {
                    MemberPickerList(
                        members: members,
                        selfId: selfId,
                        excludeMemberIds: excludeMemberIds
                    ) { selected = $0 }
                }
            }
            .navigationTitle(selected.map { "Invite \($0.fullName)" } ?? "Invite a member")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(busy)
                }
            }
        }
    }

    private func submit(_ member: Member) async {
        busy = true
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        errorMessage = await onSubmit(member.id, trimmed.isEmpty ? nil : trimmed)
        busy = false
        if errorMessage == nil { dismiss() }
    }
}

/// "Transfer captaincy" (plan §9.2): pick a team member, then confirm. The
/// offer must be *accepted* before the captaincy actually changes.
struct TransferCaptaincySheet: View {
    struct Candidate: Identifiable, Hashable {
        var memberId: String
        var name: String
        var id: String { memberId }
    }

    let candidates: [Candidate]
    let onSubmit: (String) async -> String?

    @Environment(\.dismiss) private var dismiss
    @State private var selected: Candidate?
    @State private var busy = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
                if let selected {
                    Section {
                        Text("\(selected.name) will need to accept before they become captain.")
                    }
                    Section {
                        Button(busy ? "Sending…" : "Send offer") { Task { await submit(selected) } }
                            .disabled(busy)
                        Button("Choose someone else") { self.selected = nil }.disabled(busy)
                    }
                } else {
                    Section {
                        if candidates.isEmpty {
                            Text("There is nobody else on the team to hand over to.")
                                .foregroundStyle(.secondary)
                        }
                        ForEach(candidates) { candidate in
                            Button(candidate.name) { selected = candidate }
                                .buttonStyle(.plain)
                        }
                    }
                }
            }
            .navigationTitle(selected.map { "Offer the captaincy to \($0.name)?" } ?? "Transfer captaincy")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(busy)
                }
            }
        }
    }

    private func submit(_ candidate: Candidate) async {
        busy = true
        errorMessage = await onSubmit(candidate.memberId)
        busy = false
        if errorMessage == nil { dismiss() }
    }
}

/// "Arrange a substitute" step 1 (plan §9.2 `setSubstitute`, §12.7): a
/// plain-words choice of which side of the pairing the substitute covers.
struct SubstituteCoverSheet: View {
    let partnerName: String
    let onChoose: (CoverFor) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Button("I can't come — someone will play with \(partnerName) instead") {
                        onChoose(.selfMember)
                    }
                    .buttonStyle(.plain)
                    Button("\(partnerName) can't come — someone will play with me instead") {
                        onChoose(.partner)
                    }
                    .buttonStyle(.plain)
                }
            }
            .navigationTitle("Arrange a substitute")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
    }
}

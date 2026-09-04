//
//  CalendarFeedSection.swift
//  "Calendar feed" on the Profile screen — the counterpart of
//  `web/src/screens/CalendarFeedCard.tsx` (plan §21 B1). Create, show, copy,
//  open-in-Calendar, reset or remove the member's iCal subscription URL.
//
//  This is the app's one unauthenticated read endpoint (token in the URL),
//  so the copy is deliberately blunt: treat the link like a password. The
//  app never builds the URL itself — the callables return it — and never
//  logs it.
//

import SwiftUI
import UIKit

struct CalendarFeedSection: View {
    @State private var loading = true
    @State private var feed: IcalFeedResult?
    @State private var loadError: String?
    @State private var busy = false
    @State private var actionError: String?
    @State private var copied = false
    @State private var confirming: Confirm?

    private enum Confirm: Identifiable { case reset, remove; var id: Self { self } }

    private var url: String? { feed?.url }
    private var webcalUrl: String? { feed?.webcalUrl }

    var body: some View {
        Section {
            Text("Subscribe from Apple or Google Calendar. Anyone with this link can see your bridge schedule — treat it like a password.")
                .font(.footnote).foregroundStyle(.secondary)

            if loading {
                ProgressView()
            } else if let loadError {
                Text(loadError).foregroundStyle(.red)
                Button("Try again") { Task { await load() } }
            } else if let url, let webcalUrl {
                if let actionError { Text(actionError).foregroundStyle(.red) }
                if copied { Text("Copied.").foregroundStyle(.green) }
                Text(url)
                    .font(.footnote.monospaced())
                    .textSelection(.enabled)
                    .accessibilityLabel("Your calendar link")
                Button("Copy link") {
                    UIPasteboard.general.string = url
                    copied = true
                    Task { try? await Task.sleep(nanoseconds: 3_000_000_000); copied = false }
                }
                Button("Open in Apple Calendar") {
                    if let u = URL(string: webcalUrl) { UIApplication.shared.open(u) }
                }
                Text("Google Calendar: Other calendars → + → From URL, then paste the link above.")
                    .font(.footnote).foregroundStyle(.secondary)
                Button("Reset link") { confirming = .reset }.disabled(busy)
                Button("Remove link", role: .destructive) { confirming = .remove }.disabled(busy)
            } else {
                if let actionError { Text(actionError).foregroundStyle(.red) }
                Button(busy ? "Creating…" : "Create calendar link") { Task { await create() } }
                    .disabled(busy)
            }
        } header: {
            Text("Calendar feed")
        }
        .task { await load() }
        .alert(item: $confirming) { which in
            switch which {
            case .reset:
                return Alert(
                    title: Text("Reset your calendar link?"),
                    message: Text("Your current subscription will stop working — you'll need to re-subscribe with the new link."),
                    primaryButton: .default(Text("Reset link")) { Task { await rotate() } },
                    secondaryButton: .cancel()
                )
            case .remove:
                return Alert(
                    title: Text("Remove your calendar link?"),
                    message: Text("Your current subscription will stop working. You can create a new one at any time."),
                    primaryButton: .destructive(Text("Remove link")) { Task { await remove() } },
                    secondaryButton: .cancel()
                )
            }
        }
    }

    private func load() async {
        loading = true
        loadError = nil
        do {
            let result = try await Api.getIcalFeed()
            feed = result.url == nil ? nil : result
        } catch {
            loadError = ErrorMapper.action(error)
        }
        loading = false
    }

    private func create() async {
        busy = true; actionError = nil
        do { feed = try await Api.createIcalFeed() } catch { actionError = ErrorMapper.action(error) }
        busy = false
    }

    private func rotate() async {
        busy = true; actionError = nil
        do { feed = try await Api.rotateIcalFeed() } catch { actionError = ErrorMapper.action(error) }
        busy = false
    }

    private func remove() async {
        busy = true; actionError = nil
        do { try await Api.removeIcalFeed(); feed = nil } catch { actionError = ErrorMapper.action(error) }
        busy = false
    }
}

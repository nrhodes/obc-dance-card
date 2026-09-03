//
//  HelpAndPrivacyViews.swift
//  "Getting started" and the privacy statement, mirroring
//  `web/src/screens/HelpScreen.tsx` and `PrivacyScreen.tsx` (plan §8.1
//  "Privacy law (NZ Privacy Act 2020)").
//
//  The help copy differs from the web version in exactly one place, and only
//  where it must: the web app tells members to add the site to their Home
//  Screen and to allow notifications *in the browser*. On a native app both
//  of those are already done or are done in Settings, so those sections are
//  replaced with the iOS equivalents. Everything else is word-for-word.
//
//  Privacy is reachable signed out (from the sign-in screen) as well as from
//  Profile, so a prospective or departing member can read it without an
//  account.
//

import SwiftUI

struct HelpView: View {
    var body: some View {
        List {
            Section {
                Text("A few things that help this app work well for you.")
            }

            Section("Turning on notifications") {
                Text("Go to Profile and find \"Notifications on this device\". Tap \"Turn on notifications\" and allow it when iOS asks. You'll then be told on this device when a partner responds, cancels, or invites you — as well as by email.")
            }

            Section("Locking the app") {
                Text("Profile has an optional app lock. With it on, the app asks for Face ID, Touch ID or your passcode when you come back to it. You stay signed in either way — it just covers your card when you put your phone down.")
            }

            Section("\"Looking for a partner\" vs \"Available\"") {
                Text("On a session's page you can list yourself one of two ways if you don't already have a partner:")
                VStack(alignment: .leading, spacing: 8) {
                    Text("**Looking for a partner** — the first person who claims your listing is paired with you straight away. Use this when you definitely want to play and are happy with whoever claims first.")
                    Text("**Available** — a softer listing. Someone who wants to play with you sends you an invite, which you can accept or decline. Use this when you'd like to choose.")
                }
            }

            Section("Cancelling") {
                Text("Open the session from Programme or My card and use \"Cancel this session\" on your entry. If you have a partner, they'll be told and automatically listed as looking for a partner again, so please cancel as early as you can.")
            }

            Section("Who to phone") {
                Text("Each weekday has a Partner Steward who can help you find a partner by phone. Open Programme, choose the weekday, and their name is shown at the top — look up their phone number in the members list or ask at the club.")
            }
        }
        .navigationTitle("Getting started")
    }
}

struct PrivacyView: View {
    var body: some View {
        List {
            Section {
                Text("This app is run by Orewa Bridge Club to organise dance-card partners for club sessions. This page explains, in plain language, what we store and who can see it.")
            }

            Section("What we store") {
                bullet("Your name, phone number, and playing grade — the same as the printed member booklet.")
                bullet("Your email address, used only to sign you in and to send you notifications.")
                bullet("Your dance card: who you're playing with, and any note you add to an invite.")
                bullet("Any visitor (a non-member partner) you add — their name, and their email or phone if you choose to give them.")
            }

            Section("Who can see what") {
                bullet("Other active members can see your name, grade, and phone number, and who is playing in each session.")
                bullet("Your email address and the devices you've registered for notifications are private to you and to club admins.")
                bullet("A visitor's email or phone is visible only to you (the member who added them) and to admins.")
                bullet("Club admins can see everything, to help run the club and troubleshoot problems; every action an admin takes on your behalf is logged and you're notified of it.")
            }

            Section("How long we keep it") {
                Text("We keep your details while you're an active member. If you leave the club, your account is deactivated (not deleted) so your past dance-card history stays consistent for other members' records; after a waiting period an admin can permanently erase your personal details on request. Visitor details are removed automatically if unused for 18 months. A record of admin actions is kept for 2 years for accountability.")
            }

            Section("Your choices") {
                Text("You can update your phone number and notification preferences any time in Profile. To have your personal details erased, or if you have any question about this page, contact the club.")
            }
        }
        .navigationTitle("Privacy")
    }

    private func bullet(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text("•").accessibilityHidden(true)
            Text(text)
        }
    }
}

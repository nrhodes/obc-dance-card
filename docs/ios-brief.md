# iOS app — brief for the Mac session

Run this from a Claude Code session on the Mac (Xcode 16+, iOS 17+ target), in
this repo, on branch `main`. The backend and web app are complete; the iOS app
is a **member-only** client with feature parity to the web member screens.
Admin features are web-only (plan §14.1). Nothing under `firebase/`, `shared/`,
or `web/` should need to change; if it does, stop and say why.

## Read first
`CLAUDE.md`; `docs/implementation-plan.md` §2, §3, §5, §6, §7, §8.1 (iOS rows),
§8.2 (Persistent session, Face ID), §9.2 (every non-admin callable),
§11, §12, §12A, **§14.2 (the iOS spec)**, §18; `shared/src/{models,enums,schemas,api}.ts`
(the types to mirror as `Codable`); `web/src/lib/{sessionActions,card,roster}.ts`
(pure logic to port 1:1 — same branches, same copy); `web/src/api.ts` (callable
names and payload shapes; omit `nil` fields, never send `null` for optionals);
`docs/web-push.md`; `docs/manual-test-script.md`.

## Project shape
```
ios/OBCDanceCard.xcodeproj  (SwiftPM deps: firebase-ios-sdk — Auth, Firestore,
                             Functions, Messaging, AppCheck)
ios/OBCDanceCard/
  App/            entry, AppDelegate (FCM, App Check), environment config
  Shared/Models.swift   Codable mirrors of shared/src/models.ts (enum raw values identical)
  Shared/Api.swift      one typed wrapper per callable (region australia-southeast1)
  Auth/           sign-in (email -> 6-digit code or password), session, Face ID lock
  Features/       Card, Programme, Session (actions incl. visitors/substitutes/teams),
                  Invites, Notifications, Profile (prefs, password, devices, visitors)
  Support/        NZ date helpers (mirror shared/src/time.ts), error mapping, formatting
ios/OBCDanceCardTests/  view-model tests against the emulator
ios/GoogleService-Info.plist.example  (real plist is gitignored)
```

## Non-negotiables (from the plan)
- Auth: `signIn(withCustomToken:)` after `verifyLoginCode`; `signIn(withEmail:password:)`;
  no magic links; generic error copy (no enumeration); persistent Keychain session.
- Optional **Face ID / Touch ID app lock** (`LAContext`, passcode fallback), default off,
  toggle in Profile; the Firebase session stays underneath.
- **App Check** with App Attest (DeviceCheck fallback); debug provider only in DEBUG builds
  against the emulator.
- Clients never write Firestore; every mutation is a callable. Reads are live
  `addSnapshotListener`s with error handling surfaced in the UI.
- Never log codes/tokens/emails/phones. No analytics SDKs.
- Push: `registerDevice { token, platform: "ios", label }` on token refresh;
  `unregisterDevice` on sign-out; deep links from `data` (sessionId+year, inviteId).
- Dates: `Pacific/Auckland` everywhere; session lock = `sessionCutoff` (mirror `time.ts`).
- Accessibility: Dynamic Type up to accessibility sizes, 44pt+ targets, VoiceOver labels.
- Emulator: `Auth.useEmulator`, `Firestore.useEmulator`, `Functions.useEmulator`
  behind a DEBUG scheme flag; seed with `npm run emulators` + `npm run seed -w @obc/functions`.

## Definition of done
Builds and signs in against the emulator; all member flows from
`docs/manual-test-script.md` §2–§5c work on device; view-model tests green;
TestFlight build uploaded; `docs/security-checklist.md` iOS rows filled in.

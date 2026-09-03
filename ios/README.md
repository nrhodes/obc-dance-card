# OBC Dance Card — iOS

Native SwiftUI client for members. **Member-only**: admin features (imports,
roles, erasure, broadcast, audit log, on-behalf) are web-only by design — plan
§14.1 and `docs/ios-brief.md`.

Nothing under `firebase/`, `shared/` or `web/` is changed by this app: it
mirrors `shared/src/*.ts` by hand as `Codable` types and calls the same
deployed callables.

## Requirements

- Xcode 16+ (developed against Xcode 26), iOS 17+ deployment target
- Java 21 and Node 22 — only for running the Firebase emulator to develop
  against (see `.mise.toml` at the repo root)

Dependencies come from SwiftPM (`firebase-ios-sdk` 12.x: Auth, Firestore,
Functions, Messaging, AppCheck). Open `ios/OBCDanceCard.xcodeproj` and Xcode
resolves them, or:

```sh
xcodebuild -resolvePackageDependencies -project ios/OBCDanceCard.xcodeproj -scheme OBCDanceCard
```

## Layout

```
ios/OBCDanceCard/
  App/        entry + AppDelegate, Firebase setup, environment config, stores, router, push
  Shared/     Codable mirrors of shared/src (Models, Enums, Paths) and the typed callable wrappers (Api)
  Auth/       sign-in (emailed code or password), session state, Face ID app lock
  Features/   Card, Programme, Session (+ team panel), Invites, Notifications, Profile, Common (pickers, tabs)
  Support/    NZ date helpers, formatting, error mapping
ios/OBCDanceCardTests/    unit tests for the ported pure logic and the Codable mirrors
ios/GoogleService-Info.plist.example
```

Files whose header says "port of …" are 1:1 ports of a `web/src/lib/*.ts`
module. **Change them together**: the two clients are meant to make the same
decision and say the same sentence in the same situation, and the tests here
are ports of that module's `*.test.ts`.

## Running against the emulator

The `OBCDanceCard` scheme sets `OBC_USE_EMULATORS=1`, and the app treats that
as "use the local emulator" **only in a DEBUG build** — a release build can
never be pointed at one. With it set, the app synthesises `demo-obc` Firebase
options in code, so no `GoogleService-Info.plist` is needed.

From the repo root, in separate terminals:

```sh
npm install                      # once
npm run build                    # builds @obc/shared, which functions import
npm run emulators                # Firestore + Auth + Functions on demo-obc

export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
export GCLOUD_PROJECT=demo-obc
npm run seed -w @obc/functions   # 20 fake members incl. admin@example.org
```

Then Run the `OBCDanceCard` scheme on a simulator and sign in as a seeded
member. The emulator prints the login-code email to the Functions log rather
than sending it, so watch that terminal for the 6-digit code.

On a **physical device** the simulator's `127.0.0.1` is the phone itself. Set
`OBC_EMULATOR_HOST` in the scheme's environment to your Mac's LAN address
(e.g. `192.168.1.20`) and start the emulator with `--host 0.0.0.0`.

Note the seeded programme must be **published** before the Programme tab shows
anything — members never see a draft (rules, plan §10).

## Running against a real project

Drop the real `GoogleService-Info.plist` into `ios/OBCDanceCard/` (gitignored;
see `GoogleService-Info.plist.example`), and run without `OBC_USE_EMULATORS`.
App Check uses App Attest with a DeviceCheck fallback, so the app's App Attest
key must be registered in the Firebase console before callables will accept it
— `docs/ops-runbook.md` covers that, and `docs/security-checklist.md` tracks
it.

## Tests

```sh
xcodebuild test -project ios/OBCDanceCard.xcodeproj -scheme OBCDanceCard \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=latest'
```

These are pure unit tests — no emulator, no network. They cover the ported
logic (session actions, roster, card grouping, team session view, programme
timeline, member picker), the NZ date/format helpers, deep-link resolution,
error mapping, and decoding of literal Firestore document JSON. That last set
is the one that catches **model drift**: if a field is renamed in
`shared/src/models.ts` and not here, a decoding test fails rather than a
member seeing an empty screen.

## Things the plan pins that are easy to undo by accident

- **Clients never write Firestore.** Every mutation is a callable in
  `Shared/Api.swift`. The stores in `App/Stores.swift` only read.
- **Optional fields are omitted, never sent as null** — the server's zod
  schemas reject an explicit null where a key is `.optional()`. That's what
  `payload(_:)` is for.
- **No enumeration in sign-in copy.** An unknown email and a wrong password
  produce identical text (`ErrorMapper.passwordSignIn`).
- **Never log codes, tokens, emails or phones.** Subscription failures log an
  error code and nothing else.
- **No magic links.** The code flow always says *type* this code.
- **Dates are `Pacific/Auckland`** via `Support/NZDate.swift`, never
  `Date()`-to-UTC-string.
- **Firestore local persistence is off** (shared, lent-out devices).
- **Push permission is only ever requested from the Profile toggle.**

## Not done here

- TestFlight upload: needs a signing team and an App Store Connect record.
  `DEVELOPMENT_TEAM` is deliberately empty in the project so a fresh checkout
  builds for the simulator without someone else's team id baked in — set it in
  Xcode (Signing & Capabilities) before archiving.
- Push cannot be tested against the emulator (there is no FCM emulator), and
  APNs needs a real device plus the APNs key uploaded to Firebase. Same
  constraint the web client has — see `docs/web-push.md`.
- An app icon / asset catalog: the target references `AppIcon` and
  `AccentColor` but ships without an `Assets.xcassets`, so it builds with the
  system defaults. Add one before submitting.

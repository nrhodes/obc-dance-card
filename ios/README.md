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

The `OBCDanceCard (Emulator)` scheme sets `OBC_USE_EMULATORS=1`, and the app treats that
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

Then Run the `OBCDanceCard (Emulator)` scheme on a simulator and sign in as a seeded
member. The emulator prints the login-code email to the Functions log rather
than sending it, so watch that terminal for the 6-digit code.

On a **physical device** the simulator's `127.0.0.1` is the phone itself. Set
`OBC_EMULATOR_HOST` in the scheme's environment to your Mac's LAN address
(e.g. `192.168.1.20`) and start the emulator with `--host 0.0.0.0`.

Note the seeded programme must be **published** before the Programme tab shows
anything — members never see a draft (rules, plan §10).

## Two schemes

| scheme | talks to | needs |
|---|---|---|
| **`OBCDanceCard`** (default) | the real project in the bundled plist — like the web app | `GoogleService-Info.plist` + an App Check debug token |
| `OBCDanceCard (Emulator)` | the local emulator (`demo-obc`) | emulators + seed running; **no plist** |

They differ only in environment variables: the Emulator scheme sets
`OBC_USE_EMULATORS=1` (and `OBC_EMULATOR_HOST`). CI runs the Emulator scheme,
since a runner has no plist. Emulator mode always
synthesises `demo-obc` options — it ignores a bundled plist on purpose, since
the emulator is started as `demo-obc` and a real project id would land in an
empty namespace.

## Running against a real project (Simulator or device)

1. **Plist.** Firebase console → Project settings → Your apps → the iOS app
   (bundle id `nz.org.orewabridge.dancecard`; register it if absent) →
   download `GoogleService-Info.plist` → save as
   `ios/OBCDanceCard/GoogleService-Info.plist`. Gitignored; the synchronized
   folder picks it up with no project edit. Use `obc-dance-card-dev`, not
   production, for testing.
2. **App Check debug token.** Every DEBUG build uses Firebase's debug
   provider (App Attest doesn't exist on the Simulator, and on a device needs
   console registration). On first launch the Xcode console prints
   `Firebase App Check debug token: <uuid>` — register it once per project:
   console → App Check → Apps → the iOS app → Manage debug tokens, or
   `firebase appcheck:debugtokens:create <uuid> --project obc-dance-card-dev`.
   Until it's registered, every callable fails with the generic error (the
   console shows `callable_failed … FIRFunctionsErrorDomain 16`
   unauthenticated). Each device/simulator has its own token.
3. **Be a member.** The real project only knows members an admin imported;
   your email has to be in its `members` collection or `requestLoginCode`
   silently succeeds and no code ever arrives (plan §8.2). The seed script
   refuses non-`demo-` projects by design.
4. Select the **`OBCDanceCard`** scheme (the default) and Run. HTTPS to Google — no
   LAN address, no ATS exception, any network.

Release builds use App Attest with a DeviceCheck fallback; the app's App
Attest key must be registered in the console before a TestFlight build's
callables are accepted — `docs/ops-runbook.md` covers that, and
`docs/security-checklist.md` tracks it.

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

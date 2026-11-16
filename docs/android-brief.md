# Android app — brief for the building session

Run this from a Claude Code session with Android Studio (or the command-line
SDK) available, in this repo, on branch `main`. The backend, web app and iOS
app are complete; the Android app is a **member-only** client with feature
parity to the iOS app, which itself mirrors the web member screens. Admin
features are web-only (plan §14.1). Nothing under `firebase/`, `shared/` or
`web/` should need to change except the one-value `platform` addition in plan
§21 B13 — do that first, as its own PR.

## Read first
`CLAUDE.md`; `docs/implementation-plan.md` §2, §3, §5, §6, §7, §8.1, §8.2,
§9.2 (every non-admin callable), §11, §12, §12A, §14.2 (the iOS spec — Android
follows it), **§21 B13 (the Android plan)**; `docs/ios-brief.md` and the iOS
sources under `ios/OBCDanceCard/` (the closest reference: same architecture,
same screens, same copy); `shared/src/{models,enums,schemas,api,time}.ts`
(the types and date rules to mirror); `web/src/lib/{sessionActions,card,
roster,overview,bulkAvailability,programmeView}.ts` and their tests (port
1:1 — same branches, same copy); `web/src/api.ts` (callable names and payload
shapes; omit null fields); `docs/web-push.md`; `docs/security-review-2026-11-16.md`
(the iOS-adjacent lessons: dark-mode contrast, lock-cover timing, APNs/FCM
token ordering, cohort-scoped queries); `docs/manual-test-script.md`.

## Project shape
See plan §21 B13. Package `nz.org.orewabridge.dancecard`; `android/` at the
repo root; `google-services.json` committed (public config) and listed in
`.github/secret_scanning.yml`.

## Non-negotiables (from the plan)
- Auth: `signInWithCustomToken` after `verifyLoginCode`;
  `signInWithEmailAndPassword`; no magic links; generic error copy; SDK session
  persistence; `allowBackup="false"`.
- Optional app lock via `BiometricPrompt` with device-credential fallback;
  default off; toggle in Profile; cover present in the first frame on resume;
  `FLAG_SECURE` while locked.
- App Check: Play Integrity in release, debug provider only in debug builds;
  register each device's debug token in the Firebase project (see the iOS
  notes in `docs/security-checklist.md`).
- Clients never write Firestore; every mutation is a callable; reads are live
  snapshot listeners with errors surfaced in the UI; roster-style queries are
  cohort-scoped.
- Never log codes, tokens, emails or phones. No analytics SDKs. No WebView.
- Push: data-only FCM handled in a `FirebaseMessagingService` that posts the
  notification itself; `POST_NOTIFICATIONS` requested only from the soft ask
  or Profile; `registerDevice { token, platform: "android", label }` on token
  refresh and after permission; `unregisterDevice` on sign-out; deep links
  from `data` only (`sessionId`+`year`, `inviteId`).
- Dates: `Pacific/Auckland` everywhere; session lock = `sessionCutoff`.
- Accessibility: TalkBack labels, `sp` text and the largest font scale tested,
  48 dp targets, fixed palette audited for contrast in light **and** dark.
- Emulator: Auth, Firestore and Functions `useEmulator("10.0.2.2", …)` behind
  a debug build flavour; seed with `npm run emulators` + `npm run seed -w
  @obc/functions`.

## Definition of done
Builds and signs in against the emulator; every member flow from
`docs/manual-test-script.md` §2–§5c works on a device; JVM tests green in CI
(`android-build-test`); an internal-testing build on the Play Console
installs and signs in against production with Play Integrity; Android rows
added to `docs/security-checklist.md`; Data safety form submitted.

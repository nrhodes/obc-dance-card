# Security checklist (gate before pilot)

Mirrors plan §18. This is the evidence sheet Phase 7a produces: for each item,
where it is enforced, exactly how to verify it, and its current status.

**Status legend**

- `code` — enforced in the repo and covered by an automated test that runs in
  CI (`npm test -w @obc/functions`, `npm run test:rules -w @obc/functions`,
  `npm run test:emu -w @obc/functions`).
- `console` — a one-time setting in the Firebase / Google Cloud console (or a
  `gcloud`/`firebase` CLI command run once per project) that cannot be
  expressed as a file in this repo. Must be set on every real project
  (`obc-dance-card-dev`, `obc-dance-card`) before that project goes live.
- `pending` — not yet done; who owns it is noted.

| # | Item | Enforced by | How to verify | Status |
|---|---|---|---|---|
| 1 | `beforeUserCreated` denies all; `beforeSignIn` requires `members/{uid}.active === true` | `firebase/functions/src/auth/blocking.ts` (`beforeUserCreatedHandler`, `beforeSignInHandler`) | `npm run test:emu -w @obc/functions` → `src/auth/blocking.emu.test.ts` (5 cases: no-uid, missing member, inactive member, active member, unconditional deny on create). For a client-side end-to-end check, run the emulator (`npm run emulators`) and call `createUserWithEmailAndPassword` from the web app or `curl` against the Auth emulator's `signUp` endpoint — it is rejected. | `code` |
| 2 | Email enumeration protection ON; password policy ON | Firebase Authentication → Settings, per project (Identity Platform config) | Console: **Authentication → Settings → User actions** → enable "Email enumeration protection". **Authentication → Settings → Password policy** → set "Enforce a password policy", require ≥1 letter + ≥1 number, minimum length 8. CLI verification (does not change settings): `GOOGLE_APPLICATION_CREDENTIALS=./key.json npx tsx firebase/scripts/check-auth-config.ts --project <projectId>` — prints ON/OFF for both and exits non-zero if either is off. | `console` (script in `code` to *verify* it) |
| 3 | App Check enforced on callables + Firestore; iOS App Attest; web reCAPTCHA Enterprise; debug tokens only in the emulator | Callables: `firebase/functions/src/lib/callable.ts` (`ENFORCE_APP_CHECK` param, `consumeAppCheckToken: false`). Firestore: **console** (App Check → APIs → Cloud Firestore → Enforce). Providers: **console** (App Check → Apps → configure reCAPTCHA Enterprise for the web app, App Attest for the iOS app). | Code: `npm test -w @obc/functions` → `src/lib/callable.test.ts` (defaults to `false`; reflects `ENFORCE_APP_CHECK=true`; `consumeAppCheckToken` always `false`). Console, per real project: **App Check** tab shows every app "Enforced" for both Firestore and the callable API, and set `ENFORCE_APP_CHECK=true` in `firebase/functions/.env.<projectId>` before deploying (see `.env.example`). Debug tokens: **App Check → Apps → Manage debug tokens** — confirm none exist on `obc-dance-card` (prod); a debug token is fine on `obc-dance-card-dev` for CI/manual testing only. | `code` (callable-side) + `console` (Firestore enforcement, providers, debug tokens) |
| 4 | Secrets in Secret Manager; none in the repo or CI logs | `firebase/functions/src/lib/secrets.ts` (`defineSecret`); `.gitignore` excludes `.env`, `.env.*` (except `.env.example`), `.secret.local`, service-account JSONs, the real `firebase/.firebaserc` | `git log -p -- '*.env' '*.secret.local' '*serviceAccount*' '*firebase-adminsdk*'` returns nothing; `git grep -i "pepper\|smtp_pass\|api_key" -- ':!*.example' ':!docs/*'` finds only variable *names*, never values; gitleaks runs in CI (`secret-scan` job) on every push/PR. Secrets are set with `firebase functions:secrets:set LOGIN_CODE_PEPPER` etc. per project, never written to a file in the repo. | `code` (guard + CI scan) |
| 5 | Rules: no client writes except `notifications.read`/`readAt` | `firebase/firestore.rules` | `npm test -w @obc/functions` → `src/rulesGuard.test.ts` (string-level guard: every mutating `allow` rule is `if false` except the one notifications toggle) plus the full rules-test matrix (`npm run test:rules -w @obc/functions`, 9 suites / 70 cases, one per collection in plan §10). | `code` |
| 6 | `memberPrivate` and `visitors` unreadable by other members | `firebase/firestore.rules` (`memberPrivate`, `visitors` match blocks) | `npm run test:rules -w @obc/functions` → `rules-test/memberPrivate.rules.test.ts`, `rules-test/visitors.rules.test.ts` (unauthenticated, inactive, active-other, active-self, admin cases). | `code` |
| 7 | Login-code emails contain no links; wording reviewed | `firebase/functions/src/email/templates/loginCode.ts` | `npm test -w @obc/functions` → `src/email/templates/notification.test.ts` covers escaping; manually re-read `loginCode.ts`'s copy — confirm no `href`/URL appears in `text` or `html`, and the "we will never ask you to click a link" line is present (plan §8.1 "Phishing conditioning"). `grep -n "href=\"http\|https://" firebase/functions/src/email/templates/loginCode.ts` should return nothing. | `code` |
| 8 | Rate limits observed under a scripted 50-request burst | `firebase/functions/src/lib/rateLimit.ts` (`assertRateLimit`), applied to `requestLoginCode`/`verifyLoginCode` (plan §8.1 limits: 3 requests / 15 min per email, 10 verifies / 15 min per email, looser per-IP limits) | `npm run test:emu -w @obc/functions` → `src/auth/emailCode.emu.test.ts` ("rate limit: a 4th request within 15 minutes for the same email is rejected"). For the literal "50-request burst" manual check: with the emulator running, loop `requestLoginCode` 50× for one email via the web app's dev console or a small script and confirm calls 4–50 all fail `resource-exhausted` while the emulator stays responsive. | `code` (limit logic + one boundary test) + `pending` (literal 50-burst load test — manual, not yet scripted) |
| 9 | Logs reviewed for PII after running the E2E suite | `firebase/functions/src/lib/logger.ts` (primitive-only field type) | `npm test -w @obc/functions` → `src/lib/logger.test.ts` (every `src/**/*.ts` file, excluding tests, is scanned for direct `console.*`/`firebase-functions/logger` use — allowlist is exactly `lib/logger.ts` itself and `email/provider.ts`'s emulator-only body dump, guarded by `!isDeployed()`). Manual: after a Playwright E2E run against the emulator, `grep -iE "@.*\.(com|org|nz)|\+64|02[0-9]{7,9}" firebase-emulators.out` should find nothing (no email addresses or NZ phone numbers in the log). | `code` (static scan) + `pending` (manual log grep after a real E2E run — do this once before pilot) |
| 10 | CSP has no `unsafe-eval`; `'unsafe-inline'` only on styles; `frame-ancestors 'none'`; `object-src 'none'`; `worker-src`/`manifest-src` restricted to `'self'` (Phase 7b hardening); report-only run showed no violations | `firebase/firebase.json` hosting `headers` (plan §14.1, Phase 7b task deliverable G) | `web/src/lib/csp.test.ts` (`npm test -w web`) parses `firebase.json` directly and asserts: no `unsafe-eval` anywhere; `'unsafe-inline'` appears only in `style-src`; `frame-ancestors 'none'`; `object-src 'none'`; `worker-src 'self'`; `manifest-src 'self'`; the header rule's `source` is the catch-all `"**"` (so the CSP also covers `manifest.webmanifest` and `sw.js`, not just HTML). Report-only run: deploy with a second `Content-Security-Policy-Report-Only` header (or use the browser devtools CSP debugger against the emulator/dev build) and click through every screen once; confirm the console shows zero CSP violations before removing the report-only header. | `code` (header content, incl. `worker-src`/`manifest-src`) + `pending` (report-only click-through — manual, do once before pilot) |
| 11 | Firestore backups scheduled; restore rehearsed once in the dev project | `docs/ops-runbook.md` § "Backups and disaster recovery" | Run the `gcloud firestore backups schedules create ...` command from the runbook against `obc-dance-card`; verify with `gcloud firestore backups schedules list --database='(default)'`. Rehearse a restore into `obc-dance-card-dev` per the runbook's "Restore rehearsal" steps at least once before pilot. | `console` (gcloud, one-off per project) |
| 12 | Budget alert set; `maxInstances` pinned | `maxInstances`: `firebase/functions/src/index.ts` (`setGlobalOptions({ maxInstances: 5 })`) and `firebase/functions/src/lib/callable.ts` (`callableOptions.maxInstances: 5`). Budget alert: **console**/`gcloud billing budgets create` (docs/ops-runbook.md) | Code: `grep -n "maxInstances" firebase/functions/src/index.ts firebase/functions/src/lib/callable.ts` shows `5` in both places. Console/CLI: `gcloud billing budgets list --billing-account=<ACCOUNT_ID>` shows an NZ$5 budget for the project; or **Billing → Budgets & alerts** in the console. | `code` (maxInstances) + `console` (budget alert) |
| 13 | Privacy statement published in-app; `eraseMember` tested | `eraseMember`: `firebase/functions/src/admin/members.ts`. Privacy statement page: `web/src/screens/PrivacyScreen.tsx` (`/privacy`, Phase 7b task deliverable H) | Code: `npm run test:emu -w @obc/functions` → `src/admin/__tests__/members.emu.test.ts` covers `eraseMember` scrubbing `members`, `memberPrivate`, `visitors`, denormalised `entries`/`teams` names, and notifications, plus the Auth account deletion and the 30-day/active guards. Web: `/privacy` is linked from the sign-in screen's footer (reachable signed out) and from Profile; `e2e/a11y.spec.ts` visits it and asserts the "Privacy" heading renders with zero serious/critical axe violations. Its copy mirrors plan §2 Visibility and `docs/ops-runbook.md`'s "Member erasure" retention/erasure language — re-read `PrivacyScreen.tsx` after any change to either. | `code` (`eraseMember`, privacy page + its link placement) |
| 14 | Deactivated member loses access within one token refresh | `firebase/functions/src/admin/members.ts` (`deactivateMemberHandler` → `auth.revokeRefreshTokens`); `firebase/functions/src/auth/blocking.ts` (`beforeSignInHandler` re-checks `active` on every sign-in); `firebase/firestore.rules` (`isActiveMember()` re-`get()`s the caller's doc on every request, so Firestore reads/callables stop immediately — no token wait at all) | `npm run test:emu -w @obc/functions` → `src/admin/__tests__/members.emu.test.ts` asserts `revokeRefreshTokens` is called and the Auth user is disabled; `src/auth/blocking.emu.test.ts` asserts `beforeSignIn` denies an inactive member. Manual end-to-end: deactivate a member while signed in as them in a second browser session; their next Firestore read/callable fails immediately (rules re-`get()`), and their next full sign-in attempt is denied by `beforeSignIn`. | `code` |

## Scripts referenced above

- `firebase/scripts/check-auth-config.ts` — reads a real project's Identity
  Platform config (email enumeration protection, password policy, MFA state)
  via a service account, plus a best-effort blocking-functions check via the
  Identity Toolkit Admin REST API. Requires
  `GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json`; refuses to
  run against a `demo-*` project unless `--allow-demo` is passed. Exits
  non-zero if either required protection is off.

  ```sh
  GOOGLE_APPLICATION_CREDENTIALS=./key.json \
    npx tsx firebase/scripts/check-auth-config.ts --project obc-dance-card
  ```

- `firebase/scripts/make-admin.ts` — first-admin bootstrap (plan §19). See
  `docs/ops-runbook.md` step 6.

## Items with no code artifact (console-only, per project)

These cannot be expressed as a file in this repo; they must be re-done for
every real project (`obc-dance-card-dev`, `obc-dance-card`) and re-checked
whenever a new project is stood up:

1. Email enumeration protection + password policy (Authentication → Settings).
2. App Check enforcement toggle for Firestore, and the reCAPTCHA
   Enterprise/App Attest provider configuration (App Check tab).
3. App Check debug tokens — confirm none exist on production.
4. Firestore backup schedule + restore rehearsal.
5. Billing budget alert.
6. CSP report-only click-through (can be done against any deploy, but is a
   manual browser exercise, not a repo artifact).
7. The manual post-E2E log grep for PII (item 9) — the *scan* is automated
   and runs in CI; the *grep of a real emulator log after a real E2E run* is
   a one-off manual step to do once before pilot.

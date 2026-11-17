# Security review — backend and web app (2026-11-16)

**Scope.** `firebase/` (Firestore rules, Cloud Functions, hosting config), `web/`
(React PWA, service worker), repository and CI configuration. The iOS app is
**out of scope** for this review and should get its own pass.

**Method.** Code reading against the threat model in `docs/implementation-plan.md`
§8.1 and the evidence sheet in `docs/security-checklist.md`; a production
dependency audit (`npm audit --omit=dev`); GitHub repository settings via the
API; a scan of git history for secret-shaped files. No production console
settings were inspected (they are not visible from the repo), and no live
traffic was generated against the production project.

**Status (updated 2026-11-17).** `main` is green. **H1 is largely fixed** by
#78 (zod 4.6.7, nodemailer 10.6.0, express's `proxy-addr`/`body-parser`,
`re2js`, and an npm override pinning `@grpc/grpc-js` ≥ 1.14.5 under the
Firestore SDK); the audit gate passes with 8 moderates left, all in the
`firebase-admin` 13 chain whose major bump is deliberately held. Three H1
residuals remain: the two uncapped `weekdays` arrays, Dependabot security
alerts still disabled on the repository, and the `firebase-admin` 14 move.
M1 (#82), M2 (#81), M3 (#83), L2 (#85), L4 (#84) and L5 (#86) are merged; L6
was applied in repository settings; #87 (B12, continuous deployment) is
merged as a plan, and work on it has started: `SMTP_USER` is a Secret
Manager secret (#89), a dispatch-only `deploy` job with a post-deploy smoke
test exists (#90–#92) and the first CI deploy is recorded with the verified
deployer role list (#93). The second pass went deeper on the pairing and team
transactions, member import and erasure, notification and email fan-out,
visitor and matchmaking flows, and the live state of the review cohort; it
found one Medium and two Lows, listed under "Second pass" below, and
confirmed the rest. The note in the original text that `main` was red
describes 2026-11-16 and is kept for the record.

**Headline.** The design is sound and the code follows it closely: every
mutation is a callable that parses input, resolves the caller from
`req.auth.uid`, and checks ownership; the rules are deny-by-default with one
narrow client write; login codes, the iCal feed, email escaping, logging and
secrets handling all match the plan. The findings below are mostly at the
edges — dependencies, one trusted header, a timing pad that is too short, and
a fail-open default. **`main` is currently red:** the CI dependency-audit
gate failed on the most recent run (2026-11-16) and that is finding H1.

Severity: **High** = act before the next release · **Medium** = schedule soon ·
**Low** = hardening · **Info** = accepted or noted.

| # | Severity | Finding |
|---|---|---|
| H1 | High | Known-vulnerable production dependencies; CI audit gate failing on `main`; Dependabot security alerts disabled — **fixed: #78 cleared the advisories, #107 caps the arrays, alerts enabled 2026-11-17** |
| M1 | Medium | Per-IP rate limits trust the first `x-forwarded-for` hop (client-controlled) — **fixed 2026-11-16** |
| M2 | Medium | Login-code request timing still distinguishes known from unknown emails — **fixed 2026-11-16** |
| M3 | Medium | App Check enforcement defaults to off; production value lives only in a gitignored file — **fixed 2026-11-16** |
| L1 | Low | Targeted sign-in lockout via per-email limits — **accepted 2026-11-17, recorded in plan §8.1** |
| L2 | Low | `notifications.readAt` is type-checked but not size-capped — **fixed 2026-11-16** |
| L3 | Low | Admin direct reads of `memberPrivate` bypass the on-behalf audit and notification — **fixed (PR open)** |
| L4 | Low | Audit log has no retention job despite the stated two-year retention — **fixed 2026-11-16** |
| L5 | Low | CSP `connect-src` wildcards; HSTS without `preload`; no COOP — **connect-src pinned and COOP added 2026-11-16; preload deliberately not** |
| L6 | Low | Branch protection requires 3 of 5 CI jobs; e2e not required; admins exempt — **done 2026-11-16** |
| L7 | Low | Public repo: close the plist API-key alert as intentional; add API-key application restrictions |
| I1 | Info | iOS push bodies carry member names on the lock screen (deliberate copy) |
| I2 | Info | `ping` callable is reachable unauthenticated |
| I3 | Info | Local auth persistence plus 30-day idle sign-out on shared devices (per plan) |
| **Second pass, 2026-11-17** | | |
| N1 | Medium | Production review-cohort accounts are active outside a review window, sharing one password that has been pasted outside the project |
| L8 | Low | `eraseMember` leaves the `icalTokens` lookup document behind — **fixed (#104)** |
| L9 | Low | Import reports (`imports/{id}`) keep raw CSV rows forever and survive erasure — **fixed (#105)** |
| I4 | Info | Accepting an invite reads every pending invite in the club inside the transaction — **fixed (#106)** |
| I5 | Info | A failed email send on the login-code path returns early, outside the uniform timing |
| **Third pass, 2026-11-17** | | |
| T1 | Medium | Visitor courtesy emails are sent from two callables that don't bind the SMTP secrets, and the send isn't guarded — in production the member's action commits, then fails — **fixed (PR open)** |
| T2 | Low | `deploy_ref` deploys a commit the gating CI run never tested — **fixed (PR open)** |
| T3 | Low | Production email goes out from a personal Gmail account, named in the public repo |
| T4 | Info | Deploy pipeline reviewed: federation, permissions, ordering, environment gate and smoke test are sound |
| T5 | Info | Web "reset site data" and App Check probe reviewed: sound |
| N1 | Medium | **Still open** — nine production review accounts remain active |
| **Fourth pass, 2026-11-17 — iOS app** | | |
| S1 | Medium | The Face ID app lock does not engage on a cold launch; force-quit and reopen lands on the card — **fixed (PR open)** |
| S2 | Low | Three App Check debug tokens are registered on the production project (bypass credentials for App Check) — **accepted; standing exception recorded in the checklist** |
| S3 | Info | Debug builds against production use the App Check debug provider by design; the tokens above are the cost |
| S4 | Info | iOS reviewed and sound: session storage, no URL schemes, DEBUG-only logging and emulator wiring, ATS, deep links by id, member-only callables, cohort-scoped queries |

---

## High

### H1. Known-vulnerable production dependencies; audit gate red; security alerts off

> **Largely fixed 2026-11-16 by #78** (`npm audit fix` for zod → 4.6.7 and
> express's transitives; nodemailer → 10.6.0; an npm override for
> `@grpc/grpc-js`). `main` is green. **Dependabot security alerts and
> security updates were enabled on 2026-11-17.** First read: 50 open alerts,
> every one in `development` scope (none in runtime code), 12 high; 30 of
> them are transitive under `firebase-tools` (undici 17, hono 7, MCP SDK 4,
> @hono/node-server 2, compression 1), the rest under vitest, minimatch and
> similar test tooling. **Still open from this finding:** the Dependabot
> security-update PRs are landing as they arrive; `firebase-admin` 14 is up as
> a PR and clears the last 8 moderates — `npm audit --omit=dev` is clean with it. The two
> `weekdays` arrays are capped at five in #107.

**Evidence.** `npm audit --omit=dev` at the workspace root reports 19
advisories: 1 critical, 8 high, 9 moderate, 1 low. The most recent CI run on
`main` (run 43825862276, 2026-11-16) failed at the "Dependency audit (prod
deps, high+)" step with every other job green, so the gate works — the
advisories are newer than the last green run. Separately, the GitHub API
reports "Dependabot alerts are disabled for this repository": weekly
version-update PRs run, but nothing flags a new advisory between runs.

The ones that matter for this codebase:

| Package | Installed | Severity | Why it matters here | Fix |
|---|---|---|---|---|
| `zod` | 4.5.4 | High — memory exhaustion validating oversized constrained collections | **Inlined into the deployed functions bundle** (`scripts/bundle.mjs` externalises only firebase-admin, firebase-functions, nodemailer, papaparse), so every callable runs it. Two callable arrays are constrained with `.min(1)` but have no `.max`: `SetBulkSoloStatusInputSchema.weekdays` and `BroadcastInputSchema.weekdays` (`shared/src/schemas.ts`). A callable payload can be up to 10 MB. | ≥ 4.6.6; add `.max(5)` to both arrays |
| `nodemailer` | 9.1.1 | High — process-global DNS cache reuses the TLS `servername` across transports | Used for every outgoing email via the SMTP relay. | ≥ 10.6.0. **Open Dependabot PR #67 targets 10.0.0, which is still inside the vulnerable range (≤ 10.1.3)** — retarget or close it |
| `express` 5.2.1 → `proxy-addr` 2.0.7, `body-parser` 2.3.0 | via `firebase-functions` 7.3.2 | Critical (IP spoofing via IPv4-mapped IPv6 trust subnet) / High (DoS via trailing bytes after a compressed body) | Transitive in the deployed runtime. The IP-spoofing one is adjacent to M1 below. | `npm audit fix` reports a non-breaking fix available |
| `firebase` 12.18.0 → `@grpc/grpc-js`, `re2js` | web prod dep; functions dev dep | High | Transitive in the web SDK. | Needs a patched `firebase` release; track |
| `firebase-admin` chain (`google-gax`, `uuid`, `teeny-request`, `retry-request`) | 13.x | Moderate | Transitive in the deployed runtime. | `firebase-admin` 14.5.1 clears them; a major bump (currently on the Dependabot ignore list for deploy-bundle reasons) |
| `qs`, `gaxios`, `fast-xml-parser` | transitive | Moderate / Low | | `npm audit fix` |

**Recommendation.**
1. Run `npm audit fix` (non-breaking) and regenerate the lockfile cleanly; this
   should clear zod, express's transitives, qs, gaxios.
2. Bump `nodemailer` to ≥ 10.6.0 in one PR with the functions emulator tests
   (the SMTP path itself is not exercised by tests, so do one real send from
   the dev project).
3. Add `.max(5)` to both `weekdays` arrays and adopt "every `z.array` has a
   `.max`" as a schema rule (a one-line test can grep for it, like
   `parseInput.test.ts` does for `parseInput`).
4. Enable Dependabot security alerts in the repository settings (Code
   security and analysis) so advisories surface the day they land.
5. Plan the `firebase-admin` 14 move with the deploy-bundle fix it needs.

## Medium

### M1. Per-IP rate limits trust a client-controlled header

> **Fixed 2026-11-16.** `lib/clientIp.ts` takes the platform-appended hop
> (last entry for callables, second-to-last for the Hosting-routed iCal feed;
> env-tunable `TRUSTED_PROXY_HOPS` / `ICAL_TRUSTED_PROXY_HOPS`) and the feed
> logs the entry count so the hop assumption can be confirmed in production.
> Unit tests in `lib/clientIp.test.ts`; emulator tests assert the bucket key
> for a spoofed prefix on both endpoints.

**Where.** `clientIp()` in `firebase/functions/src/auth/emailCode.ts` and
`firebase/functions/src/ical/feed.ts` returns the **first** `x-forwarded-for`
entry.

**Why it matters.** On Cloud Run and behind a Firebase Hosting rewrite,
Google's front end *appends* the real client address; anything the client
puts in the header arrives before it. So:

- the per-IP buckets (30 code requests/hour, 60 verifies/hour, 300 iCal
  fetches/hour) can be bypassed by rotating a fabricated header; and
- an attacker can set the header to a victim's address — the club's Wi-Fi
  NAT, say — and burn that bucket, blocking every member on that network
  from requesting a login code for an hour.

The per-email limits do not depend on the header, so brute-force protection
is intact; this is an availability and bypass issue.

**Recommendation.** Use the hop Google appended, not the first one. For
callables (direct Cloud Run) that is the **last** entry; for the iCal path,
which arrives through the Hosting rewrite, it is the **second-to-last**
(Hosting adds a hop). Alternatively configure Express's `trust proxy` with
the right hop count and use `req.ip`. Add a unit test that sends a spoofed
header and asserts the bucket key is the appended address. Note this is the
same area as the critical `proxy-addr` advisory in H1.

### M2. Login-code request timing still distinguishes known from unknown emails

> **Fixed 2026-11-16.** The unknown/inactive path now performs the provider's
> connection handshake (`EmailProvider.warm()`, `verify()` on SMTP) so it does
> the same work as a send; the uniform floor is 1 200 ms and tunable via
> `LOGIN_CODE_UNIFORM_RESPONSE_MS`; an overrun logs
> `login_code_uniform_floor_exceeded`. Regression test:
> `src/auth/emailCode.timing.emu.test.ts`.

**Where.** `requestLoginCodeHandler` (`auth/emailCode.ts`). Enumeration is
an explicit row in the threat model ("Uniform response + timing").

**Why it matters.** The handler awaits the SMTP send inside the timed region
and then sleeps only up to a 400 ms target. An SMTP relay round-trip commonly
takes longer than that, so a known-active address answers in "SMTP time"
while an unknown address answers in a flat ~400 ms. The uniform-timing control
holds only when sending is faster than the pad, which in production it often
is not.

**Recommendation.** Take the send off the request path: write the
`emailCodes` document and let a Firestore trigger (or a fire-and-forget
after the response is composed) do the SMTP call, so the request returns in
constant time regardless of outcome. If keeping it inline, raise the pad well
above observed SMTP latency and add jitter, and measure against the dev
project. Firebase's own "email enumeration protection" (checklist row 2)
covers the password path, not this callable.

### M3. App Check enforcement defaults to off; the production setting is not in the repo

> **Fixed 2026-11-16.** Enforcement is now the default; only the literal
> `false` disables it, and the committed `.env.demo-obc` is the one place
> that does. A deployed instance refuses to start unenforced, so a
> misconfigured deploy fails its rollout. `.env.example` no longer ships a
> `false` line, the runbook and checklist are amended, and this machine's
> gitignored `.env` (which carried `false` with no production override — a
> deploy from here would have shipped unenforced) had the line removed.

**Where.** `lib/callable.ts` declares `ENFORCE_APP_CHECK` with
`default: false`. Production relies on `firebase/functions/.env.obc-dance-card`,
which is gitignored.

**Why it matters.** A deploy from any fresh checkout — a new machine, a
future CI deploy job, a disaster-recovery rebuild — silently ships every
callable with App Check off. Nothing fails; the only signal is a cold-start log
line. App Check is the plan's primary control against cost abuse and
automated clients. Firestore's own enforcement is a console setting and is
unaffected, so data access still needs an active member.

**Recommendation.** Invert the default to `true`; the committed
`.env.demo-obc` already sets `false` for the emulator. Or make `callable.ts`
refuse to load when `isDeployed()` and the param is false. Either way,
commit the non-secret production `.env.<projectId>` values (enforcement flag,
email provider, from-address, SMTP host and user, web base URL): none are
secrets, and the plan already treats them as configuration. The secrets stay
in Secret Manager as now.

## Low

### L1. Targeted sign-in lockout via per-email limits

> **Accepted 2026-11-17** by the club, as is (no per-code refinement for
> now). Recorded in `docs/implementation-plan.md` §8.1, "Code-request
> flooding" row, with the revisit condition.

Three requests and ten verifies per address per 15 minutes mean anyone who
knows a member's email can keep them from signing in by spamming the
callables. This is the documented trade-off and the alternative (per-IP) is
weak behind the club's NAT. Keep it, but record it as an accepted risk in
§8.1, and consider counting verify failures against the code document only
(already capped at 5 per code) rather than also per email, so a legitimate
member can recover by requesting a fresh code.

### L2. `notifications.readAt` is not size-capped

> **Fixed 2026-11-16.** The rule now requires `readAt.size() <= 40` when it
> is a string; rules test added (41 chars and 100 000 chars rejected, an
> offset-form ISO instant accepted).

The rule (audit L1) checks `readAt is string` but not its length, so a member
can store up to the 1 MB document limit in their own notifications. Add
`request.resource.data.readAt.size() <= 40`.

### L3. Admin direct reads of `memberPrivate` bypass the on-behalf audit

> **Fixed 2026-11-17.** No admin screen on web or iOS read another member's
> private document directly (verified by grep), so `isAdmin()` is dropped
> from the rule; the rules test now asserts the admin read fails. Admins
> keep the audited, notifying callable path.

The `memberPrivate` rule allows any admin to read any member's document from
a client: email, device tokens, and the plaintext iCal token. The same data
read through `getIcalFeed({ onBehalfOfMemberId })` writes an audit row and
notifies the member; a direct Firestore read does neither. Check whether the
admin web UI needs direct `memberPrivate` reads at all (the admin screens
reviewed use callables and `members`); if not, drop `isAdmin()` from that
rule. Otherwise document the asymmetry.

### L4. Audit log has no retention job

> **Fixed 2026-11-16.** `purgeExpired` now deletes `auditLog` rows older than
> two years (step 6), reported as `auditLogDeleted`; emulator test added.

§8.1 states "audit log retained 2 years"; `purgeExpired` prunes email codes,
rate limits, invites, visitors and notifications (180 days) but never
`auditLog`. Add a two-year purge, or amend the statement.

### L5. CSP and transport headers could be tighter

> **Done 2026-11-16 (part).** `connect-src` now pins the two project function
> hosts, drops `*.run.app`, `*.cloudfunctions.net` and the unused
> `firebaseio.com` entries, and `Cross-Origin-Opener-Policy: same-origin` is
> added; `csp.test.ts` guards all of it. **Not done, deliberately:** HSTS
> `preload`. `web.app` is already on the browser preload list via its parent
> domain, and setting `preload` on a future custom club domain would bind
> every subdomain of it to HTTPS forever — a decision for whoever owns that
> domain, not a header to flip in passing. Verify after the next hosting
> deploy that sign-in and the calendar still work on the production site
> (the CSP cannot be exercised against production by CI).

`connect-src` allows `https://*.run.app` and `https://*.cloudfunctions.net`
(every GCP customer) and `https://*.googleapis.com`. With no inline scripts
the practical exposure is small, but pinning to the project's own function
hosts narrows any future XSS to no exfiltration path. HSTS has no `preload`;
there is no `Cross-Origin-Opener-Policy`. All low-cost.

### L6. Branch protection is lighter than CI implies

> **Done 2026-11-16** (repository setting, no code). All five CI jobs are now
> required (`e2e-test` and `ios-build-test` added), the rules apply to
> administrators, linear history is required (every merge has been a squash)
> and conversations must be resolved before merging. Left as-is, deliberately:
> no required reviews (single maintainer; a self-review requirement would
> block every PR) and "require branches to be up to date" off (it would force
> a rebase of every open Dependabot PR after each merge; the squash + full CI
> on the PR head is the accepted trade-off).

Required status checks are `build-test`, `secret-scan` and `emulator-tests`.
`e2e-test` and `ios-build-test` are not required, "require branches to be up
to date" is off, administrators are exempt, and no review is required.
Reasonable for a single maintainer, but a red e2e run can be merged. Add the
two missing checks at least.

### L7. Public repository: close the plist alert as intentional; restrict the API keys

The repository is public. The Firebase web config and
`ios/OBCDanceCard/GoogleService-Info.plist` are public by design and
documented as such; the one open GitHub secret-scanning alert (#2, "Google
API Key", opened 2026-09-04) is that plist. Close it as "used in tests /
false positive" so a real leak is not lost in the noise. Because the keys are
public, add **API key application restrictions** in the Google Cloud console
as defence in depth: HTTP referrers (`*.web.app`, the custom domain) on the
web key and the iOS bundle identifier on the iOS key. Firebase keys being
public is only safe together with App Check and rules; restrictions cost
nothing. `club-data/programme-2026/*.csv` are also committed — programme
content only, no personal data found (the `stewardEmail` column is blank).
Keep it that way; a members CSV must never land there.

## Info

- **I1.** Push notifications to iOS carry names in the title and body, so
  they appear on the lock screen. The plan's "ids only" wording refers to the
  data payload; the human copy is deliberate. Note it as accepted.
- **I2.** The `ping` callable answers unauthenticated requests and echoes the
  caller's uid when signed in. Harmless, but unnecessary surface; remove or
  gate it before launch.
- **I3.** Web auth persistence is local and the idle sign-out is 30 days, per
  the plan's shared-device decision. Fine for members' own devices; the
  "Sign out" button and no offline persistence are the mitigations on shared
  ones.


---

## Second pass (2026-11-17)

### N1. Production review-cohort accounts are active outside a review window

**Evidence.** Firebase Auth export for `obc-dance-card`: nine
`test0N@orewabridgeclub.org` accounts, none disabled, all with a password
set; one signed in on 2026-11-16. `docs/ops-runbook.md` step 6 says the
cohort is to be deactivated outside a review window. The shared password was
also typed into an AI chat session earlier this month, which counts as
disclosure outside the project.

**Why it matters.** The cohort partition keeps these accounts from seeing
real members, so this is not a data-exposure path. It is a standing
foothold: nine working logins with one password that anyone holding it can
use to drive every member callable against production, burn rate limits
(see M1), generate notifications, and consume function and Firestore quota.

**Recommendation.** Run the provisioning script with `--deactivate` now, and
re-provision with a fresh password only for the days an Apple review is
actually open (the script is idempotent and re-enables them). Treat the
review password like any credential: never into chat, email or a ticket;
hand it to Apple through App Store Connect's review notes only.

### L8. `eraseMember` leaves the `icalTokens` lookup document behind

> **Fixed 2026-11-17, #104.** Erasure deletes the hash-keyed lookup doc in the
> same batch; emulator test added.

`eraseMember` rewrites `memberPrivate` without `icalToken`, but never deletes
the hash-keyed `icalTokens/{sha256(token)}` document, and `purgeExpired` does
not touch that collection. The feed itself is already dead — it 404s for an
inactive member, and an erased member is inactive with no Auth account — so
this is hygiene: an orphan row mapping a token hash to a uid, forever. Delete
the lookup doc in step 2 of erasure (and in `deactivateMember`, where the
member can be reactivated, leave it; the feed resumes correctly).

### L9. Import reports keep raw CSV rows forever and survive erasure

> **Fixed 2026-11-17, #105.** The persisted copy of every import report
> (members and programme) drops `raw`; the admin's on-screen report is
> unchanged; `purgeExpired` deletes import documents older than two years.

Every non-dry-run `importMembers` stores its report at `imports/{id}`:
counts, warnings naming members, and per-row errors that include the `raw`
CSV row (name, email, phone). The collection is server-only (rules deny
reads; admins see nothing of it in the UI), nothing purges it, and
`eraseMember` does not visit it. So an erased member's name and email can
persist indefinitely in old import reports. Low, because only the Admin SDK
can read it, but it contradicts the erasure promise. Options: stop storing
`raw` (keep row number and message), add `imports` to the two-year purge,
and have `eraseMember` scrub matching rows.

### I4. Accepting an invite reads every pending invite in the club

> **Fixed 2026-11-17, #106.** Two member-scoped equality queries replace the
> club-wide scan on both the pairing and team acceptance paths.

`respondToInvite` runs `where('status', '==', 'pending')` with no further
filter inside its transaction, then filters in memory for invites touching
the same members and sessions. Correct, and small at club scale, but every
accept contends with every other pending invite's writes. Not a security
issue; noted for whoever next touches that transaction (filter by
`fromMemberId`/`toMemberId` in two queries).

### I5. A failed email send on the login-code path escapes the uniform timing

If the SMTP send throws, `requestLoginCode` rejects immediately with a
generic error, which is faster than the padded success path and only
happens for known addresses. It needs the relay to be failing at that
moment, so it is not a practical oracle. If M2's equal-work change is ever
revisited, catching the send error and still padding would close it.

### Re-checked and still sound

The pairing core: invites are created and accepted inside transactions that
re-read both members' entries, re-check the session lock and publish state,
expire competing invites, and run `validatePairingGroup` on the mirrored pair
before commit; `force` is admin-only and checked before the transaction.
Member import: cell and row caps, email normalisation and duplicate
detection, admins never deactivated by omission, the mass-deactivation
threshold, Auth disable plus refresh-token revocation, visitor promotion only
on real runs. Erasure: active and 30-day guards, name confirmation, scrub
order with the Auth deletion last, denormalised names anonymised in entries
and teams. Fan-out: every email body HTML-escaped, digest and courtesy
templates link-free, push data carries ids only, dead tokens pruned.
Matchmaking: same cohort, opted-in, not-busy, deduplicated, capped
recipients. Web: every free-text field (`invite.message`, entry and visitor
notes, programme notes) is rendered through React with no raw HTML, and the
app contains no external links at all.


---

## Third pass (2026-11-17, afternoon) — what merged since the first pass

Scope: everything merged to `main` after the first pass that was not one of
the review's own fixes or a dependency bump — the SMTP_USER move (#89), the
deploy pipeline (#90–#93), the web "honest screen" (#94), the committed
production config — plus a regression check that every merged fix is present
on `main`, and a refresh of the live state.

**Regression check.** All present on `main`: the trusted-hop client IP in
both endpoints (M1), `warm()` plus the 1 200 ms floor (M2), enforce-by-default
with the deployed-instance guard (M3), the 40-char `readAt` cap (L2), audit
and import retention (L4, L9), the pinned CSP and COOP (L5), the iCal lookup
deletion on erasure (L8), the member-scoped invite scan (I4), the `.max(5)`
array caps (H1). `npm audit --omit=dev` at high: clean (8 moderates in the
`firebase-admin` 13 chain remain). Required checks: all five.

### T1. Visitor courtesy emails are sent from callables that don't bind the SMTP secrets

**Where.** `visitors/signUp.ts` (`signUpWithVisitor`) and `entries/entries.ts`
(`cancelEntry`) call `getEmailProvider().send(...)` for the visitor courtesy
and cancellation emails. Both are exported with the bare `callableOptions`
— no `secrets: SMTP_SECRETS` — and neither send is wrapped.

**Why it matters.** In production `EMAIL_PROVIDER=smtp`, so the provider
reads `SMTP_USER.value()` / `SMTP_PASS.value()`. A secret that isn't bound to
the running function throws on access. The send happens *after* the
transaction has committed, so the entries are written, the handler then
throws, and the member sees "Something went wrong" for an action that
actually succeeded; the visitor never gets the email the sponsor opted them
into. Pre-existing (SMTP_PASS was already unbound there before #89); the
functions that do bind the secrets — login codes, the notification trigger,
reminders, digest — are correct. Production logs show no occurrence yet,
which is consistent with no member having used a visitor with courtesy emails
on since the SMTP provider went live.

**Recommendation.** Bind `SMTP_SECRETS` on both callables; wrap each courtesy
send in try/catch that logs a generic `visitor_email_failed` (no address) and
returns normally, since a mail failure must never fail an action that has
already committed; and add a static test in the style of `logger.test.ts`
that every file calling `getEmailProvider().send` exports its function with
`SMTP_SECRETS` bound, so the next email call site can't regress it.

### T2. `deploy_ref` deploys a commit the gating run never tested

**Where.** `ci.yml` `deploy` job: `needs:` the five CI jobs, which run on the
dispatched `main` head, but `actions/checkout` uses `inputs.deploy_ref` when
set. Any commit or tag — including a branch tip never merged — can be
deployed to production from a `main` dispatch.

**Why it matters.** Rollback to an earlier `main` commit is the intended use
and is safe (it was tested when merged). An arbitrary ref bypasses the gate.
Mitigations already in place are good: dispatch needs write access, the
`production` environment has a required reviewer and a branch policy, and
federation is pinned to this repository.

**Recommendation.** In the "config exists" step, after checkout, require
`git merge-base --is-ancestor HEAD origin/main` and fail otherwise, so only
commits that have been on `main` can deploy. Optionally add
`attribute.ref == 'refs/heads/main'` to the federation attribute condition.

### T3. Production email is sent from a personal Gmail account, named in the public repo

**Where.** `firebase/functions/.env.obc-dance-card` (committed, public):
`EMAIL_FROM="Orewa Bridge Club <rhodes.neil@gmail.com>"`,
`SMTP_HOST=smtp.gmail.com`. `SMTP_USER` is a secret, but the From address
reveals the account.

**Why it matters.** Three separate things. A personal address is now in a
public repository (it was already on every email members receive, so the
incremental exposure is small). The plan says courtesy emails come "from a
no-reply address" and §19 prefers the Workspace relay; a personal account
also ties the club's mail to one person's 2-factor setup and app password.
And consumer Gmail SMTP caps sending at roughly 500 recipients a day, which
a broadcast plus reminders plus digests can approach for a club of this
size, after which mail silently fails until the quota resets.
`CLUB_CONTACT_EMAIL` is also blank, so visitor emails fall back to the
hard-coded default.

**Recommendation.** Move to a club-owned mailbox — a Workspace account, or
at minimum a club Gmail — with a no-reply display name; set
`CLUB_CONTACT_EMAIL`; rotate `SMTP_PASS` when the account changes. If the
personal account stays for now, record it as an accepted interim in §19.

### T4. Deploy pipeline — reviewed, sound

Workload Identity Federation with no stored key; `permissions: contents:
read, id-token: write` on the job only; the `production` environment carries
a required reviewer and a branch policy; `needs:` all five jobs; concurrency
group per project without cancel-in-progress; actions pinned to SHAs;
functions → rules → hosting order; a pre-flight that refuses to deploy
without the committed project config and refuses a config that names a
secret; `--non-interactive` throughout; the post-deploy smoke test checks
the site title, `/version.json` against the deployed SHA, and that an
unauthenticated `requestLoginCode` gets App Check's 401 (proof the bundle
loaded, with no rate-limit side effect since App Check rejects first). The
deployer role list is least-privilege and recorded in the plan and runbook;
`cloudscheduler.admin` at project level is the broadest item and is what
scheduled functions need. The gitleaks allowlist is one exact path. Nothing
to change beyond T2.

### T5. Web "honest screen" (#94) — reviewed, sound

`classifyMemberDocError` separates "not active" from "browser not verified"
by probing App Check, so a member is never told their membership lapsed when
it was the attestation. "Reset site data" unregisters workers, clears caches,
deletes the Firebase IndexedDB stores and web storage, then replaces the
location with the same-origin sign-in route. No external navigation, no
retained state.

### N1 — still open

The nine production review accounts remain active (checked again today).
This needs the provisioning script run with `--deactivate` from a machine
with Google credentials; `gcloud auth application-default login` on the Mac
is the quickest route now that no key file exists.

### Live state (2026-11-17 afternoon)

Dependabot alerts: 15 open, all development scope, none high (down from 50).
Secret-scanning: the one plist API-key alert is still open — close it as
intentional (L7). `npm audit --omit=dev` at high: clean. Branch protection:
all five checks required, admins included.


---

## Fourth pass (2026-11-17, evening) — the iOS app

First review of `ios/`. Scope: session and App Check handling, the Face ID
app lock, push and deep links, what is stored on the device, logging,
network and build configuration, which callables the app can reach, and the
queries it runs. Plus a delta check on backend and web: nothing merged since
the third pass beyond that pass's own fixes and the admin 14 bump.

### S1. The app lock does not engage on a cold launch

> **Fixed 2026-11-17.** `AppLock` starts locked when the preference is on,
> the cover prompts as soon as it appears, and `AppLockTests` pins the
> initial state.

**Where.** `Auth/AppLock.swift`: `isLocked` is in-memory and starts `false`;
`lockIfEnabled()` is only ever called from the scene-phase handler in
`OBCDanceCardApp.swift` on `.background` / `.inactive`.

**Why it matters.** The lock is advertised in Profile as protecting the card
when the phone is handed over or left unlocked. After a force-quit (or a
restart, or the system evicting the app), the next launch constructs
`AppLock` unlocked and SwiftUI's first phase change is to `.active`, so the
member's card renders with no prompt. The Firebase session is in the
Keychain underneath, as designed, so there is nothing else in the way.
Anyone who can swipe the app away can bypass the lock. The in-session
behaviour — cover in the first frame on background, prompt on return — is
correct.

**Recommendation.** Start locked when the preference is on:
`isLocked = isEnabled` in `AppLock.init`, and prompt on first `.active`. Add
an `AppLock` unit test for that initial state. One line plus a test.

### S2. Three App Check debug tokens are registered on the production project

> **Accepted 2026-11-17** as a standing exception, recorded in
> `docs/security-checklist.md` ("Standing exceptions") with the review and
> retirement terms. Why two simulator tokens: App Check mints one per
> simulator device, so the iPhone and iPad simulators each have their own.

**Evidence.** `appcheck:debugtokens:list` on `obc-dance-card`: "Neil's
iPhone (Debug build)" and "Simulator on MacBook Air (3)" from 4 September,
"iPad Pro 11 Simulator (Neil)" from 11 September. `docs/security-checklist.md`
row 3 says debug tokens must not exist on production.

**Why it matters.** A debug token is a bearer credential: any client that
presents it, from anywhere, is issued valid App Check tokens for the iOS app
on the production project. The tokens have been printed in Xcode consoles,
pasted into this conversation, and sit in simulator preferences on this Mac.
The blast radius is "bypass App Check as the iOS app", which still leaves
Auth and rules in force, so this is Low — but it is three standing bypasses
that the checklist says should be zero.

**Recommendation.** Delete the two simulator tokens now (re-register one on
the day it is needed; it takes a minute), keep the phone's while active
development continues, and rotate it when iOS development pauses. Record in
the checklist that production carries exactly one debug token while the iOS
app is under development, reviewed monthly. The structural fix is a dev
project (`obc-dance-card-dev`) for debug builds, which B12 also noted; until
then this is the accepted cost of S3.

### S3. Debug builds against production use the debug provider (by design)

`FirebaseService.configure()` installs `AppCheckDebugProviderFactory` in
every DEBUG build, App Attest with a DeviceCheck fallback in Release. The
plan chose "debug builds talk to the real project, like the web", which
requires S2's tokens. Noted so the trade-off is visible, not as a defect.

### S4. Reviewed and sound

- **Session.** Firebase Auth's default Keychain storage, which the SDK marks
  `AfterFirstUnlockThisDeviceOnly` — the session is neither backed up nor
  migrated to another device. No manual token storage anywhere. Sign-out
  unregisters the push device first, then signs out.
- **On-device data.** Firestore runs with `MemoryCacheSettings` — no disk
  cache of roster data (the shared-device decision, same as web). Only
  `UserDefaults` is used, for the FCM token, the app-lock preference and the
  soft-ask flag; the privacy manifest declares exactly that.
- **Callables.** Thirty-seven member callables, no admin ones, no
  `onBehalfOfMemberId` or `force` anywhere; every payload omits nil fields.
  Roster-style queries (directory, teams, session entries) are cohort-scoped.
- **Logging.** Five `print` sites, every one inside `#if DEBUG`, each
  logging a name and an error code only.
- **Network.** `NSAllowsLocalNetworking` lives in a Debug-only Info.plist for
  the LAN emulator; Release has no ATS exceptions. The emulator switch is
  compiled out of Release (`useEmulators` is a constant `false`), so no
  environment variable can repoint a shipping build.
- **Inbound surface.** No URL schemes, no universal links. The only inbound
  path is a push payload, resolved to a session id and year or an invite id;
  anything else opens the alerts list.
- **Lock cover.** Appears with no transition when the scene resigns active,
  so the app-switcher snapshot never shows the card.
- **Callable errors** are mapped to fixed copy; `failed-precondition`
  messages (server-authored, display-safe) are the only server text shown.
- **Tests.** The emulator sign-in test skips unless the emulator scheme is
  active and the emulator answers, so its `Bearer owner` bypass can only ever
  hit a local emulator.
- **Build.** `ENABLE_TESTABILITY` is Debug-only; Release has assertions off
  and whole-module optimisation; the only entitlement is `aps-environment`;
  signing is automatic under the club's team.

---

## Confirmed sound

Checked and matching the plan; listed so the next reviewer need not repeat.

**Firestore rules.** Deny-by-default catch-all; no client writes except the
owner flipping `read`/`readAt` on their own notification (affected keys and
types checked); active/admin derived from a `get()` of the caller's own
document, never from token claims; cohort partition enforced on `members`,
`entries` and `teams`; `memberPrivate` and `visitors` scoped to owner and
admin; programme sub-collections gated on publish status; server-only
collections (`auditLog`, `emailCodes`, `rateLimits`, `imports`, `icalTokens`,
`integrity`) denied outright; a string-level test guards the "no client
writes" property.

**Callables.** Every handler parses input with zod through `parseInput`
(issue paths only, no values echoed), then `requireMember`/`requireAdmin`,
then an ownership check. Verified across invites (to/from), entries,
substitutes, visitors (sponsor or admin), teams (captain-only mutations),
iCal tokens, profile and devices. On-behalf actions are admin-only, audited,
and notify the member; deactivated targets are rejected. Last-admin guard on
role changes and deactivation; erasure needs 30 days deactivated plus a name
confirmation; mass deactivation needs an explicit flag; CSV imports are
capped (1 MB, 2 000 rows, 500-char cells); invites and broadcasts are
rate-limited; bulk availability is capped at 200 sessions.

**Authentication.** Login codes: CSPRNG, HMAC-SHA256 with a Secret Manager
pepper, hashed document ids, 10-minute TTL, 5 attempts then invalidated,
single use, constant-time compare, one uniform error message, active-member
re-check before minting the custom token, `lastLoginAt` recorded. Blocking
functions deny all self-signup and any inactive sign-in. Setting a password
is server-side and requires `auth_time` within 10 minutes; removal rotates to
an unknowable value.

**iCal feed.** 256-bit CSPRNG token, SHA-256-keyed server-only lookup,
identical 404 for every "no" case, GET/HEAD only, per-token and per-IP limits
(subject to M1), inactive member kills the feed, ICS text escaped and folded,
`nosniff`, private caching, only a hash prefix logged.

**Email.** Every interpolated value HTML-escaped; the login-code email
contains no links; STARTTLS required; the console provider writes the
emulator outbox only when not deployed; recipient domain only in logs.

**Logging and secrets.** Primitive-only logger; no PII fields found at the
call sites reviewed. Secrets via `defineSecret`, bound per function;
gitignore, gitleaks in CI and the secret-scanning ignore list are consistent;
a scan of git history for secret-shaped files found only example and public
config files.

**Web.** No `dangerouslySetInnerHTML`, `innerHTML` or `eval`; React escaping
throughout; CSP with no inline or unsafe scripts, `frame-ancestors 'none'`,
`object-src 'none'`, plus `X-Frame-Options: DENY`, HSTS, `nosniff`, referrer
and permissions policies; the service worker precaches the shell only, never
intercepts Firebase traffic, and resolves notification clicks to encoded
same-origin paths; the error boundary never renders error text; acting-as
state is memory-only; admin routes are cosmetic in front of server checks;
`localStorage` holds only the push token and a last-activity timestamp;
emulator wiring is env-gated and off in the production env file.

**CI and supply chain.** All actions pinned to commit SHAs; workflow
`permissions: contents: read`; `npm ci`; the audit gate (it fired); gitleaks;
hard `demo-*` project guards in test helpers and seeds; login codes masked in
uploaded emulator logs.

## Not verified here

- Console-side items from `docs/security-checklist.md`: email enumeration
  protection and password policy (row 2), App Check enforcement and providers
  on the production project (row 3), backups (row 11), budget alert (row 12).
- The checklist's three `pending` manual exercises: the 50-request burst
  (row 8), the post-E2E log PII grep (row 9), the CSP report-only
  click-through (row 10). None are recorded as done.
- The iOS app (deferred by request).

## Suggested order of work

1. **N1** — deactivate the production review cohort (one command, no deploy).
1a. **T1** — bind the SMTP secrets on `signUpWithVisitor` and `cancelEntry`,
   guard the courtesy sends, add the static test. Small, and it is a live
   defect for any member who uses a visitor with courtesy emails on.
1b. **H1 residuals** — merge the Dependabot security-update PRs as they
   land; schedule the `firebase-admin` 14 bump.
2. **M3** — flip the App Check default and commit the non-secret production
   env values.
3. **M1** — take the appended `x-forwarded-for` hop, with a spoofed-header test.
4. **M2** — move the SMTP send off the login-code request path.
5. **L2, L4, L5, L6, L7** — each is a small, independent change.
6. Record **L1**, **I1**, **I3** as accepted risks in §8.1, and decide **L3**.

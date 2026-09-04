# OBC Dance Card — Implementation Plan (v2, security-focused)

> **Audience.** This document is written to be executed by an implementing model or
> engineer who was not present for the design conversation. It is deliberately
> explicit: every decision that could reasonably go two ways is settled here. Where
> the plan says MUST / MUST NOT, treat it as a hard requirement and do not
> re-litigate it; where it says SHOULD, use judgement but stay within the stated
> intent. If something is genuinely ambiguous, the *Open items* section at the end is
> the only place a choice remains — everything else is decided.
>
> **State of the repo.** Phase 0 (scaffold) already exists at
> `/home/nrhodes/Work/obc_dance_card` — staged in git, not yet committed. It was built
> against an earlier version of this plan. Section 15 lists the exact reconciliation
> edits to make to that scaffold *before* starting Phase 1. Read
> `shared/src/*.ts`, `firebase/firestore.rules`, and `firebase/functions/src/**` first.

---

## 1. Context

Orewa Bridge Club (OBC), New Zealand, publishes a printed booklet each year: a
programme of bridge sessions organised by weekday (Mon/Wed/Fri 1pm; Tue juniors 7pm;
Thu 7pm), each divided into named multi-week **series** (e.g. "Marion Taylor Pairs
(Scr) — Jan 12, 19, 26, Feb 2"), plus Holiday-Bridge one-offs and a member list with
phone numbers. Members hand-write a partner's name on a dotted line against each
session — their **dance card**. A per-weekday Partner Steward helps people find
partners by phone.

This project replaces the paper card with a Firebase backend, a web PWA, and a
native iOS app. Members see the programme, invite each other, see who is playing on a
date, advertise as *Available* / *Looking for Partner*, sign up with a **visitor**
(non-member) partner, and are notified when a partner cancels or an invite arrives.

Members skew elderly (70s–90s). Login and every flow must be minimal-tap,
large-type, and forgiving. Security must be strong *without* adding friction: the
attack surface is small (a private club roster with names, emails, phones) but the
data is personal and the users are a demographic that is heavily targeted by
phishing — so the app must never train them to click links in emails to "log in",
and must never leak the roster.

## 2. Decisions (settled)

| Area | Decision |
|---|---|
| Scope | Scheduling only. No scores/results/standings (stay in NZ Bridge software). |
| Backend | Firebase: Auth (with Identity Platform upgrade for blocking functions), Firestore, Cloud Functions gen2 (TypeScript, **Node 22**), FCM, Hosting, App Check, Cloud Scheduler. Region `australia-southeast1`. |
| Web | React 18 + Vite + TypeScript PWA. Serves desktop and Android. |
| iOS | Native SwiftUI, Firebase iOS SDK. Optional Face ID app-lock. |
| Membership | Closed. Only admin-imported members can sign in. Import creates the Auth user. |
| Visitors | A member may pair with a **visitor** (name required; email/phone optional). Visitors have **no account, cannot sign in, ever**. Their contact details are visible only to the sponsoring member and admins. |
| Login | (a) Emailed **6-digit code**, or (b) **email + password** for members who set one. **No magic links.** No self-signup. No password-reset email (forgot password → use the code). |
| Sessions | Persistent (Keychain / browser local). Users stay signed in until sign-out or deactivation. |
| Data writes | **Clients never write Firestore directly**, with exactly one exception (marking own notifications read). Every mutation is a callable Cloud Function that validates, authorises, and writes in a transaction. |
| Pairing model | Sessions are the unit. A "series sign-up" = one invite covering all the series' sessions; on accept it creates a pairing per session atomically. |
| Series partner | Register once as a pair; a one-week **substitute** may be recorded per session (unless series `allowSubstitute=false`). The *remaining* partner arranges and records the sub. |
| Individual series | Members arrange weekly partners themselves; app **warns** (does not block) on a repeat partner within the series. |
| Teams series | A **team captain** creates a team for the series and invites members (or adds visitors). Team size 4–6 (per-series `teamMin`/`teamMax`, defaults 4/6). Members join for the whole series; per-session absences and session-only substitutes are handled by the captain. |
| Matchmaking | *Looking for Partner* = first member to claim is paired immediately (poster notified, can cancel). *Available* = softer; a claim sends a normal invite. On a Teams series the same two statuses read "Looking for a team" / "Available for a team" and only a **captain with space** can claim. |
| Act-on-behalf | **Admins only**; every on-behalf action is audit-logged **and the affected member is notified**. Partner Stewards are ordinary members in v1. |
| Notifications | In-app + push (FCM iOS/web) + email now. SMS adapter interface only (no provider). |
| Programme entry | CSV import (weekdays / series / singles) into a draft; admin publishes. |
| Member data | CSV import from NZ Bridge export (name, email, phone, grade). Re-import syncs; absent members are deactivated, never deleted. |
| Grades | `Open`, `Intermediate`, `Junior`, `Unknown`. Eligibility notes displayed, not enforced. |
| Time zone | All date logic in **`Pacific/Auckland`**. Cloud Functions run in UTC — never call `new Date().toISOString().slice(0,10)` for "today"; use the shared `todayNZ()` helper. |
| Visibility | Active members can see: the published programme, every session roster (names), the noticeboard, and other members' **name, grade, phone, email** (amended 2026-09-05: full contact directory, Neil's sign-off; was booklet-parity phones-only with emails private). **Device tokens remain private** (owner + admin only, `memberPrivate`). |

## 3. Rules for the implementer

1. **Follow the phases in order** (§16). Each phase ends with its *Definition of done*
   satisfied, `npm run build && npm run typecheck && npm run lint && npm test` green,
   and the rules tests green. Do not start the next phase with a red build.
2. **Types first.** `shared/` is the single source of truth for document shapes,
   enums, callable contracts, and zod schemas. Functions and web import from it; iOS
   mirrors it by hand (`Codable`). Never define a second copy of a type.
3. **No client writes** except `notifications/{id}.read/readAt`. If you find yourself
   writing a Firestore rule that allows a client `create`/`update`, stop — it belongs
   in a callable.
4. **Every callable** follows the template in §9.1: zod-parse input → `requireMember`
   / `requireAdmin` → resolve acting member → preconditions inside a transaction →
   write → audit (if on-behalf/admin) → notify → return typed result. No exceptions.
5. **Never trust a client-supplied identity.** The acting member is `req.auth.uid`
   unless an admin supplies `onBehalfOfMemberId`.
6. **Invariants in §7 are law.** Every mutation that touches a pairing must leave
   the store in a state that `validatePairingGroup` accepts. Write the test first.
7. **Do not log secrets or PII.** Log ids, action names, counts, and error codes.
   Never log a login code, a token, an email address, or a phone number.
8. **Do not add dependencies casually.** The allowed set is listed per workspace in
   §14. Adding one requires a one-line justification in the PR description.
9. **Do not weaken a security control to make a test pass.** If a rule blocks
   something you think should be allowed, re-read §8 and §10; if still unsure, leave
   it blocked and note it in *Open items*.
10. **Emulator only for tests.** Nothing in the test suites may talk to a real
    Firebase project. The seed script MUST refuse any project id not starting with
    `demo-`.

## 4. Architecture

```
 iOS (SwiftUI) ─┐                                 ┌─ Firestore (rules: read-only for clients)
                ├─ Firebase Auth ── App Check ─────┤
 Web PWA ───────┘        │                         ├─ Cloud Functions gen2 (all writes, all auth logic)
                         │                         │      ├─ callables (§9)
                  blocking fns                     │      ├─ Firestore triggers (notification fan-out)
                  (beforeUserCreated: deny all;    │      └─ scheduled (reminders, integrity sweep, purge)
                   beforeSignIn: must be active)   ├─ FCM (push)
                                                   └─ Email provider (Postmark | SendGrid | Workspace SMTP)
```

- Clients read Firestore directly (real-time listeners) and call functions to change
  anything.
- The Admin SDK inside functions bypasses rules; therefore functions carry the full
  authorisation logic themselves (§9).
- App Check is enforced on callables and Firestore in production (reCAPTCHA
  Enterprise on web, App Attest on iOS; debug tokens in the emulator).

## 5. Domain model (Firestore)

Authoritative TypeScript lives in `shared/src/models.ts`. This section is the spec
the code must match. `Timestamps` = `{ createdAt, updatedAt }` ISO strings.

### 5.1 `members/{memberId}` — public-to-members profile

`memberId` **is the Firebase Auth uid.** Created only by `importMembers`.

```
id, firstName, lastName, phone, email?, grade, role ('member'|'admin'), active (bool),
lastImportId?, + Timestamps
```

`email` (amended 2026-09-05, §2 Visibility): the member's address, denormalised from
`memberPrivate.emailLower` so the members directory can show it without a
`memberPrivate` read. Written by `provisionMember` on every create and update (it's
always the address the row was matched on, so it's kept in sync — and backfills any
member doc created before this field existed). Optional in the type: existing prod
docs lack it until `firebase/scripts/backfill-member-emails.ts` runs against them; the
UI must tolerate absence. No tokens here — device tokens stay on `memberPrivate`
(owner + admin only, §5.2).

### 5.2 `memberPrivate/{memberId}` — owner + admin only

```
id, emailLower (unique, login identity), notificationPrefs {
  push, email, reminders, matchmakingAlerts, digest ('immediate'|'daily'),
  reminderDaysBefore (int 0..7)
}, devices: [{ token, platform ('ios'|'web'), label?, lastSeenAt }]  (max 10),
hasPassword (bool, maintained by server), lastLoginAt?,
icalToken? (plaintext, §21 B1), icalTokenCreatedAt?, + Timestamps
```

`icalToken`/`icalTokenCreatedAt` (§21 B1): the plaintext iCal subscription
token, when the member has one, so `getIcalFeed` can redisplay the
subscription URL — DEVIATION from that section's sketch ("store hashed
only"), recorded deliberately: rotating on every view would break existing
calendar subscriptions, exactly like Google Calendar's re-displayable
"secret address". This doc is already owner+admin read-only via rules and
written only by callables, so the token's confidentiality is no weaker than
the account's. The server-only `icalTokens/{sha256hex(token)}` doc (§5.10) is
the one the unauthenticated feed endpoint actually consults.

### 5.3 `visitors/{visitorId}` — sponsor + admin only

```
id, displayName (required, 1..80 chars), email? (validated, lowercased), phone?,
createdByMemberId, notes?, courtesyEmails (bool, default false),
lastUsedAt, + Timestamps
```

A visitor belongs to the member who created it. Other members see only
`displayName` via the denormalised copy on entries (§5.6) — never the visitor doc.

### 5.4 `programmes/{year}` and sub-collections

```
programmes/{year}                 id ("2027"), year, status ('draft'|'published'),
                                  importedAt?, publishedAt?, + Timestamps
  weekdays/{weekday}              id, weekday, label, startTime, seatedByTime,
                                  partnerStewardMemberId?, notes?, + Timestamps
  series/{seriesId}               id, weekday, name, scoring ('Scr'|'Hcp'),
                                  format ('Pairs'|'Teams'|'Individual'),
                                  bestOf {n,m}|null, allowSubstitute, eligibilityNote?,
                                  generalNote?, order, sessionIds: string[],
                                  teamMin (int, Teams only, default 4), teamMax (int, default 6), + Timestamps
  sessions/{sessionId}            id, date (ISO, NZ local), weekday, seriesId|null,
                                  kind ('series'|'holidayBridge'|'noBridge'),
                                  title, partnerRequired, bookable (bool),
                                  seriesName?, scoring?, format?, + Timestamps
```

`sessionId` is deterministic: `${year}-${date}-${weekday}` for singles and
`${seriesId}-${date}` for series sessions. `partnerRequired` is `true` for Pairs and Individual series sessions (members arrange a partner; Individual just rotates), `false` for Teams sessions (entered via a team) and `noBridge`, and per the CSV for `holidayBridge`. `bookable` = `kind !== 'noBridge' && date >= todayNZ()` is *not* stored — it is computed; the stored field is only `kind`.
(Remove `bookable` from the stored shape; keep `partnerRequired`.)

### 5.5 Partner references

```ts
type PartnerRef =
  | { kind: 'member'; memberId: string; displayName: string }
  | { kind: 'visitor'; visitorId: string; displayName: string };
```

`displayName` is denormalised at write time so rosters render without a lookup and
without exposing the visitor document.

### 5.6 `entries/{sessionId}_{memberId}` — one member's card line for one session

The document id is **deterministic**: there can only ever be one entry per member
per session, by construction. Re-signing-up after a cancel updates the same doc.

```
id, sessionId, date, weekday, seriesId|null, memberId,
status: 'confirmed' | 'looking_for_partner' | 'available' | 'unavailable' | 'substituted' | 'cancelled',
partner: PartnerRef | null,
pairingId: string | null,            // shared by all entries of one pairing (null for team entries)
teamId: string | null,               // set for every entry that belongs to a team (Teams series)
teamSessionOnly: boolean,            // true for a session-only team substitute added by the captain
substitute: PartnerRef | null,       // on the *covered* member's entry: who stands in
partnerSubstitute: PartnerRef | null,// on the *remaining* member's entry: who their partner sent
isSubstituteFor: string | null,      // on a member-substitute's own entry: memberId they cover
note?, createdBy, onBehalfBy?, + Timestamps
```

Status meanings:
- `confirmed` — paired (with a member or a visitor), or a member of a team (`teamId` set, `partner = null`).
- `looking_for_partner` — public, first-claim-wins.
- `available` — public, claim sends an invite.
- `unavailable` — solo, like `looking_for_partner`/`available` (I6); never shown on the
  noticeboard, never alerted on. "Don't offer me / don't ask me for this session" — not
  a booking, but it still occupies the member's slot for every "is this member free"
  precondition (§21 B2).
- `substituted` — this member is paired but is being covered this session.
- `cancelled` — withdrawn. Kept for history; treated as absent.

### 5.7 `invites/{inviteId}`

```
id, scope ('session'|'series'|'team'), sessionIds: string[] (1..N), seriesId|null,
teamId|null (scope 'team' only), fromMemberId (the captain for team invites), toMemberId, status ('pending'|'accepted'|'declined'|'cancelled'|'expired'),
message? (≤200 chars), expiresAt (ISO; 7 days or the first session's date, whichever is earlier),
respondedAt?, createdBy, onBehalfBy?, + Timestamps
```

### 5.8 `notifications/{notificationId}`

```
id, memberId, type, title, body, data: Record<string,string>,
channelsSent: ('inapp'|'push'|'email'|'sms')[], read, readAt?, + Timestamps
```

### 5.9 `teams/{teamId}` — one team, for one Teams-format series

```
id, year, seriesId, name (default "<Captain surname> team"), captainMemberId,
members: Array<{ ref: PartnerRef; joinedAt }>   // includes the captain; members or visitors
status ('forming'|'active'|'disbanded'),
+ Timestamps
```

`teamId` is deterministic: `${seriesId}-${captainMemberId}` at creation (a captain has
at most one team per series). Readable by all active members (roster parity: the
booklet would list team members); writable only by callables.

### 5.10 Server-only collections (rules deny all client access)

```
auditLog/{id}      at, actorMemberId, action, targetMemberId?, entityRef?, before?, after?, detail?
emailCodes/{id}    emailLower-keyed doc id (sha256 of email): codeHmac, expiresAt, attempts, consumedAt?
rateLimits/{key}   windowStart, count      (key = `${bucket}:${sha256(subject)}`)
imports/{importId} kind, actorMemberId, startedAt, finishedAt?, report
icalTokens/{hash}  sha256hex(token)-keyed doc id: memberId, createdAt (§21 B1 — O(1) feed lookup, at most one per member)
```

## 6. Time and dates

- Store dates as `YYYY-MM-DD` strings meaning *NZ local calendar date*.
- `shared/src/time.ts` exports `todayNZ(now = new Date())`, `isPastNZ(date)`,
  `sessionCutoff(date, startTime)` (the instant after which a session is locked:
  its start time in `Pacific/Auckland`). Implement with `Intl.DateTimeFormat`
  (`timeZone: 'Pacific/Auckland'`) — no date library needed.
- A session is **locked** once `now >= sessionCutoff`. Locked sessions reject every
  member mutation. Admins may override with `force: true` (audited).

## 7. Invariants (must hold after every transaction; tested directly)

Let `G(pairingId)` = all non-cancelled entries with that `pairingId`.

- **I1 Uniqueness.** At most one entry doc per (session, member) — guaranteed by the
  deterministic id. A member has at most one non-cancelled entry per session.
- **I2 Member–member mirror.** If entry `S_A` is `confirmed` with
  `partner = {member B}`, then `S_B` exists, is `confirmed` or `substituted`, has
  `partner = {member A}`, and both share `pairingId`.
- **I3 Visitor pairing is one-sided.** If `S_A.partner.kind === 'visitor'` then
  `pairingId` is set, and no other entry shares that `pairingId`.
- **I4 Substitution shapes.** For a pairing (A,B) on session S where B is covered by X:
  `S_B.status = 'substituted'`, `S_B.substitute = X`, `S_A.partnerSubstitute = X`;
  if X is a member, `S_X` exists with `status='confirmed'`, `partner={member A}`,
  `isSubstituteFor = B`, same `pairingId`. No other substitution fields are set
  anywhere in `G`.
- **I5 No orphan fields.** `substitute`, `partnerSubstitute`, `isSubstituteFor` are
  null unless I4 applies. `partner` and `pairingId` are null on solo statuses.
- **I6 Solo statuses are solo.** `looking_for_partner` / `available` entries have
  `partner = null`, `pairingId = null`.
- **I7 Locked sessions are immutable** to members (§6).
- **I9 Team consistency.** For every team `T` with status `active`/`forming` and every
  session `S` in `T.seriesId`: every member-kind ref in `T.members` has an entry
  `S_M` with `teamId = T.id`, `teamSessionOnly = false`, and status `confirmed` **or**
  `cancelled` (a cancelled team entry is a one-session absence, §9.3 — the team is
  unchanged); every non-cancelled entry with `teamId = T.id` and
  `teamSessionOnly = false` belongs to a rostered member. Visitor team members have
  no entry — they are listed on the team doc only. Team entries have `partner = null`,
  `pairingId = null`, no substitution fields. A `teamSessionOnly` entry is `confirmed`,
  belongs to a non-rostered member, and exists only for a session where some rostered
  member's entry is `cancelled`. `T.captainMemberId` is in `T.members`; `T.members` has
  no duplicate refs; `|T.members| ≤ series.teamMax`.
- **I8 Visitors never authenticate.** No Auth user may exist whose email matches a
  visitor's email unless that email is also an active member's (the import may
  later promote a visitor — §12.5).

`shared/src/pairing.ts` exports `validatePairingGroup(entries: Entry[]): string[]`
(I1–I6) and `validateTeamGroup(team: Team, series: Series, entries: Entry[]): string[]`
(I9), each returning all violations (empty = valid). Every pairing/team callable
re-validates inside its transaction before commit; the nightly sweep runs both.

## 8. Security design

### 8.1 Threat model

| Asset | Threat | Controls |
|---|---|---|
| Member roster (names, phones) | Unauthenticated read; scraping by ex-member | Rules require active member (checked via `get()` of caller's member doc — no stale claims); deactivation revokes refresh tokens; App Check |
| Device tokens | Read by other members | Kept on `memberPrivate` only; owner/admin read |
| Member emails | Scraping by ex-member / non-admin misuse | Amended 2026-09-05 (§2 Visibility, Neil's sign-off): denormalised onto `members` and readable by any active member — same control as name/grade/phone (active-member gating via rules `get()`, revoked on deactivation, App Check). Residual risk: an ex-member who scraped the directory before deactivation retains emails as well as phones; mitigation is unchanged (active-member gating + refresh-token revocation on deactivation), not a new exposure this amendment introduces beyond what already applied to phones. |
| Visitor PII | Read by non-sponsors | `visitors` readable by sponsor + admin only; only `displayName` denormalised onto entries |
| Accounts | Login-code brute force | CSPRNG 6-digit; HMAC-SHA256 with secret pepper; 10-min TTL; 5 attempts then invalidated; single use; new request invalidates old; constant-time compare |
| Accounts | Code-request flooding / email bombing | Rate limits: 3 per email / 15 min; 10 verifies per email / 15 min; per-IP limits kept loose (30 requests, 60 verifies / hour) because the club wifi NATs many members behind one address; App Check; generic response |
| Accounts | Enumeration | Uniform response + timing for known/unknown emails; Firebase "email enumeration protection" ON |
| Accounts | Self-signup / visitor signs in | `beforeUserCreated` rejects all client creations; `beforeSignIn` requires `members/{uid}.active === true`; visitors have no Auth user |
| Accounts | Password attacks | Firebase password policy (min 8, require 1 letter+1 number); Firebase's built-in sign-in throttling; no reset-email flow exposed |
| Accounts | Phishing conditioning | Emails never contain login links. Code emails say "type this code in the app; we will never ask you to click a link to sign in." |
| Cards | IDOR — acting as another member | Acting member always from `req.auth.uid`; on-behalf requires admin + audit + notify target |
| Cards | Split/mismatched pairings | All pairing writes in one transaction; `validatePairingGroup` before commit; nightly sweep + repair with audit |
| Cards | Tampering with past sessions | Lock at session start (I7) |
| Teams | Non-captain edits roster; captain adds someone without consent | Only `captainMemberId` may invite/remove/disband (checked in-transaction); members join only by accepting a team invite; anyone may leave their own team; captaincy transfer requires the new captain's acceptance |
| Privilege | Self-promotion to admin | `role` only via `setMemberRole` (admin); rules deny all client writes to `members`; last-admin guard |
| Functions | Malformed / oversized input | zod schema on every callable; CSV ≤ 1 MB, ≤ 2 000 rows, cell ≤ 500 chars; message fields length-capped |
| Functions | Cost abuse / DoS | App Check enforced; `maxInstances: 5`; `timeoutSeconds: 60`; rate limits; budget alert NZ$5 |
| Email | HTML injection via names | All interpolated values HTML-escaped; text/plain alternative always sent |
| Email | Spam via visitor emails | Visitor courtesy emails opt-in per visitor, only on confirm/cancel, from a no-reply address, include sponsor name, max 20 visitors per member per season |
| Secrets | Leakage | `defineSecret()` for pepper + provider keys; `.env` gitignored; `.env.example` has no values; CI secret scan (gitleaks) |
| Supply chain | Vulnerable deps | `package-lock.json` committed; `npm ci`; `npm audit --omit=dev --audit-level=high` in CI; Dependabot weekly |
| Web | XSS | React default escaping; **no** `dangerouslySetInnerHTML`; CSP (§14.1) |
| Web | Clickjacking / MITM | `X-Frame-Options: DENY`, HSTS, HTTPS only (Firebase Hosting) |
| Shared devices | Roster left visible | Web: no Firestore offline persistence by default; "Sign out" prominent; optional auto-lock after 30 days idle. iOS: optional Face ID app lock |
| Logs | PII in logs | Structured logger wrapper that only accepts ids/enums/numbers |
| Backups | Data loss | Firestore scheduled daily backups, 30-day retention (ops) |
| Privacy law (NZ Privacy Act 2020) | Unlawful retention | Purpose statement in-app; `eraseMember` + `deleteVisitor`; auto-purge visitors unused 18 months; audit log retained 2 years |
| iCal feed | Token theft / scraping / enumeration | 256-bit CSPRNG token, sha256-keyed server-only lookup, owner-readable plaintext (deliberate, §21 B1), uniform 404, per-token + per-IP rate limits, inactive member kills feed, rotate/remove self-service, feed carries only the member's own schedule with display names |

### 8.2 Authentication flows

**Provisioning (admin):** `importMembers` → for each new row: `auth.createUser({ email, emailVerified: true, disabled: false })` → uid → write `members/{uid}` + `memberPrivate/{uid}`. Existing rows: update names/phone/grade; if email changed, `auth.updateUser(uid, { email })`. Absent rows: `active=false`, `auth.updateUser(uid, { disabled: true })`, `auth.revokeRefreshTokens(uid)`.

**Code sign-in:**
1. Client calls `requestLoginCode({ email })`.
2. Function: normalise; rate-limit (email, IP); look up `auth.getUserByEmail`
   *and* `members/{uid}.active`. **Regardless of outcome**, sleep-to-uniform (target
   ~400 ms total) and return `{ ok: true }`. If known+active: generate
   `crypto.randomInt(0, 1_000_000)` zero-padded; store `emailCodes/{sha256(email)}` =
   `{ codeHmac: HMAC(pepper, email + ':' + code), expiresAt: now+10m, attempts: 0 }`
   (overwriting any prior); send email (text + HTML) containing the code only.
3. Client calls `verifyLoginCode({ email, code })`.
4. Function: rate-limit; load doc; if missing/expired/consumed → generic failure;
   `attempts++` (write before compare); if `attempts > 5` → delete doc, generic
   failure; `timingSafeEqual(HMAC(...), stored)`; on match → mark `consumedAt`,
   `auth.createCustomToken(uid)`, update `memberPrivate.lastLoginAt`, return
   `{ token }`.
5. Client `signInWithCustomToken(token)`. Persistence: default local.

**Password:** Client `signInWithEmailAndPassword`. To *set* a password
(amended 2026-09-05, audit M1 — supersedes the original client-side
`updatePassword`/`requires-recent-login` design, whose re-auth *navigation*
confused members): the client calls the server-side `setPassword` callable,
which requires the session's `auth_time` to be within the last **10 minutes**
(server-enforced; 10 not 5 so a member who just signed in is never re-prompted).
On a stale session it rejects with `failed-precondition` +
`details.reason = 'recent-login-required'`; the Profile UI then — without ever
leaving the password section, and keeping the typed password — requests a login
code to the member's own email, takes the 6 digits inline, signs in with the
custom token (refreshing `auth_time`), and retries automatically. `setPassword`
also sets `memberPrivate.hasPassword = true` and sends a `security`
notification. Remove password: `removePassword()` callable
uses Admin SDK `updateUser(uid, { password: <random 64 bytes> })`? — **No.** Firebase
cannot unset a password; instead the callable rotates it to an unknowable random
value and sets `hasPassword=false`. Document this in the UI as "Remove password".

**Blocking functions** (Identity Platform):
- `beforeUserCreated`: `throw new HttpsError('permission-denied')` unconditionally.
  (Admin SDK creations do not trigger blocking functions.)
- `beforeSignIn`: read `members/{uid}`; if missing or `active !== true` → throw.

**Deactivation / role change:** write doc → `revokeRefreshTokens(uid)` → the next
token refresh fails `beforeSignIn`. Existing ID tokens live ≤ 1 h; rules re-check
`active` via `get()` on every request, so access ends immediately for Firestore
reads and callables (both read the member doc).

### 8.3 Callable hardening checklist (apply to every function)

- `onCall({ enforceAppCheck: true, consumeAppCheckToken: false, region, maxInstances, timeoutSeconds: 60, memory: '256MiB' }, handler)`. (App Check enforcement is toggled by an env flag so the emulator works without it; production sets it true.)
- Input parsed with the zod schema from `shared/src/schemas.ts`; on failure throw `invalid-argument` with the zod issue path only (no echo of values).
- `requireMember(req)` reads `members/{uid}` inside the function (not claims).
- Rate-limit helper `assertRateLimit(bucket, subject, limit, windowSec)` backed by `rateLimits` with a transaction.
- All reads-then-writes inside `db.runTransaction`. Re-read every document you assert on *inside* the transaction.
- Return only fields the caller is entitled to see (never a `memberPrivate` or `visitors` doc for someone else).
- Errors: use `HttpsError` codes `unauthenticated | permission-denied | invalid-argument | failed-precondition | not-found | resource-exhausted`; messages are safe for display and reveal nothing about other members.

## 9. Callable functions (the complete API)

All in `firebase/functions/src/`. Names are the deployed callable names.

### 9.1 Template

```ts
export const sendInvite = onCall(opts, async (req) => {
  const input = SendInviteInput.parse(req.data);                 // 1 zod
  const caller = await requireMember(req);                       // 2 auth
  const actor = await resolveActingMember(caller, input.onBehalfOfMemberId); // 3
  const result = await db.runTransaction(async (tx) => {         // 4 preconditions + writes
    ... re-read, assert, write ...
  });
  if (actor.onBehalfBy) await audit(...);                        // 5
  await notify(...);                                             // 6 (outside tx)
  return result;                                                 // 7 typed
});
```

### 9.2 Catalogue

| Name | Who | Input (zod) | Preconditions | Effects | Audit | Notify |
|---|---|---|---|---|---|---|
| `requestLoginCode` | anyone (App Check) | `{email}` | rate limits | writes `emailCodes`; sends code email | — | — |
| `verifyLoginCode` | anyone (App Check) | `{email, code:/^\d{6}$/}` | see §8.2 | consumes code; returns custom token | — | — |
| `markPasswordSet` | member | `{}` | — | `memberPrivate.hasPassword=true` | — | — |
| `removePassword` | member | `{}` | — | rotate to random; `hasPassword=false`; revoke tokens | — | email "password removed" |
| `updateMyContact` | member | `{phone?}` | — | `members/{uid}.phone` | — | — |
| `updateMyPrefs` | member | `NotificationPrefs` | — | `memberPrivate.notificationPrefs` | — | — |
| `registerDevice` / `unregisterDevice` | member | `{token, platform, label?}` | ≤10 devices | `memberPrivate.devices` | — | — |
| `importMembers` | admin | `{csv, dryRun?, allowMassDeactivation?}` | size limits; refuses to deactivate more than max(5, 20% of active) without opt-in | §8.2 provisioning; `imports/{id}` | `member_import` | — |
| `setMemberRole` | admin | `{memberId, role}` | not last admin | role; revoke tokens | `role_changed` | target: "you are now an admin" |
| `deactivateMember` / `reactivateMember` | admin | `{memberId}` | — | active flag; Auth disabled; revoke; cancel future entries (cascade §9.3) | `member_deactivated` | partners of cancelled sessions |
| `eraseMember` | admin | `{memberId, confirmName}` | inactive ≥ 30 days | scrub PII (names → "Former member", phone/email removed, visitors owned → deleted), keep entries anonymised | `member_erased` | — |
| `importProgramme` | admin | `{year, weekdaysCsv, seriesCsv, singlesCsv, dryRun?}` | programme not published or `replace:true` | writes draft docs; deterministic ids | `programme_import` | — |
| `publishProgramme` | admin | `{year}` | draft exists | status=published | `programme_publish` | broadcast "2027 programme is out" |
| `updateSeries` / `updateSession` | admin | partial docs | published allowed | edits; if a session is removed, cascade-cancel its entries | `programme_edit` | affected members |
| `sendInvite` | member | `{scope, sessionId? \| seriesId?, toMemberId, message?, onBehalfOfMemberId?}` | to ≠ from; to active; sessions bookable & unlocked; neither has active entry on any target session; no duplicate pending invite; rate 30/day | creates invite | if on-behalf | to: `invite_received` |
| `respondToInvite` | member (the invitee) | `{inviteId, accept, onBehalfOfMemberId?}` | pending, unexpired; on accept: all sessions still free for both | accept: pairings for every session (I2); decline: status | if on-behalf | from: `invite_accepted`/`declined` |
| `cancelInvite` | member (the sender) | `{inviteId}` | pending | status=cancelled | if on-behalf | to: `invite_cancelled` |
| `setSoloStatus` | member | `{sessionId, status: lfp\|available\|unavailable, note?}` | bookable, unlocked, no *booked* entry (an existing solo status upserts freely) | upsert entry (I6) | if on-behalf | matchmaking alert (opt-in members) for `lfp` |
| `setBulkSoloStatus` (§21 B2) | member | `{status: available\|unavailable\|clear, filter: {weekdays[], fromDate?, toDate?}, onBehalfOfMemberId?}` | expands to ≤200 bookable, unlocked, non-`noBridge` sessions across every published year | booked entries skipped (reported); solo/cancelled/absent entries upserted (`clear`→`cancelled`) | if on-behalf | — (self); on-behalf: target notified |
| `claimLookingForPartner` | member | `{sessionId, posterMemberId}` | poster's entry is `lfp`; claimer free | pairing (I2), poster's note cleared | if on-behalf | poster: `claimed` |
| `signUpWithVisitor` | member | `{scope, sessionId?\|seriesId?, visitorId}` | visitor owned by actor; sessions free & unlocked | one entry per session, `partner={visitor}` (I3) | if on-behalf | visitor courtesy email if opted in |
| `createVisitor` / `updateVisitor` / `deleteVisitor` | member | `{displayName, email?, phone?, courtesyEmails?}` | ≤20 visitors/member/season; delete only if no future entries | visitor doc | — | — |
| `setSubstitute` | member (the *remaining* partner or the covered partner) | `{entryId, substitute: {kind, memberId\|visitorId}}` | series.allowSubstitute; unlocked; sub free (if member) | I4 shape | if on-behalf | sub (if member), other partner |
| `clearSubstitute` | member | `{entryId}` | I4 present | revert to I2 shape | if on-behalf | sub, other partner |
| `cancelEntry` | member | `{entryId, onBehalfOfMemberId?}` | unlocked; entry active | §9.3 cascade | if on-behalf | partner: `partner_cancelled`; team: captain `team_member_absent` |
| `createTeam` | member (becomes captain) | `{seriesId, name?}` | series.format='Teams'; no existing team for this captain in series; captain free on all sessions | team doc (`forming`), captain entries for all sessions (I9) | if on-behalf | — |
| `inviteToTeam` | captain | `{teamId, toMemberId, message?}` | team not full; invitee active, not already in a team for this series, free on all sessions; no duplicate pending | invite `scope:'team'` | if on-behalf | to: `team_invite_received` |
| `addVisitorToTeam` / `removeVisitorFromTeam` | captain | `{teamId, visitorId}` | visitor owned by captain; team not full | team.members (no entries for visitors) | if on-behalf | — |
| `respondToInvite` (team scope) | invitee | as above | pending; still free on all sessions; team not full | accept: add to `team.members`, create entries for all sessions; team → `active` once `≥ teamMin` | if on-behalf | captain: `team_member_joined`/`declined` |
| `leaveTeam` | member (self) | `{teamId}` | not captain (captain must transfer or disband) | remove from members; cancel own future entries | if on-behalf | captain: `team_member_left` |
| `removeFromTeam` | captain | `{teamId, ref}` | ref ≠ captain | remove; cancel their future entries | if on-behalf | removed member: `team_removed` |
| `transferCaptaincy` | captain | `{teamId, toMemberId}` | target in team | creates a `team` invite of kind transfer; on accept sets `captainMemberId` | if on-behalf | both |
| `disbandTeam` | captain | `{teamId}` | unlocked sessions remain | status `disbanded`; cancel all future team entries | if on-behalf | all members: `team_disbanded` |
| `addTeamSessionSubstitute` / `clearTeamSessionSubstitute` | captain | `{teamId, sessionId, ref}` | some team member's entry for S is cancelled; sub free | `teamSessionOnly` entry (member) or note on team (visitor) | if on-behalf | sub (if member) |
| `claimLookingForPartner` (Teams series) | captain | `{sessionId, posterMemberId}` | poster `lfp`; caller captains a team in this series with space; poster free on all series sessions | add poster to team for the whole series (I9) | if on-behalf | poster: `claimed` |
| `markNotificationsRead` | member | `{ids[]}` | own | read=true | — | — |
| `getIcalFeed` (§21 B1) | member | `{onBehalfOfMemberId?}` | — | reads only, never creates | if on-behalf | if on-behalf: `on_behalf_action` |
| `createIcalFeed` (§21 B1) | member | `{onBehalfOfMemberId?}` | no existing token | mints token; writes `memberPrivate` + `icalTokens` in one transaction | if on-behalf | `security`; if on-behalf also: `on_behalf_action` |
| `rotateIcalFeed` (§21 B1) | member | `{onBehalfOfMemberId?}` | token exists | new token; old `icalTokens` doc deleted, new one written, `memberPrivate` updated, in one transaction | if on-behalf | `security`; if on-behalf also: `on_behalf_action` |
| `removeIcalFeed` (§21 B1) | member | `{onBehalfOfMemberId?}` | — (idempotent if none) | deletes `icalTokens` doc + `memberPrivate` fields | if on-behalf | `security`; if on-behalf also: `on_behalf_action` |
| `broadcast` | admin | `{title, body, weekdays?}` | — | notification per member | `broadcast_sent` | all |
| `runPairingSweep` | admin | `{repair?: boolean}` | — | same as scheduled sweep | `pairing_repair` | — |
| `ping` | anyone | — | — | health | — | — |

HTTP (not a callable — plan §21 B1's one deliberate exception to "clients only read Firestore / everything else is a callable"):
- `icalFeed` — `GET /ical/{token}.ics` (`onRequest`, no App Check, unauthenticated). `text/calendar` feed of the token's member's own schedule, authorised by the URL token instead of Firebase Auth. See §21 B1 for the full design.

Scheduled (Cloud Scheduler, `Pacific/Auckland`):
- `sendSessionReminders` 08:00 daily — for each member with `reminders=true`, sessions at `today + reminderDaysBefore`.
- `verifyPairingConsistency` 03:00 daily — runs `validatePairingGroup` over all pairings and `validateTeamGroup` over all non-disbanded teams with sessions `date >= todayNZ()`; logs violations; if `REPAIR_ENABLED`, repairs deterministically (prefer the state the audit log last recorded; otherwise cancel both sides and notify) and writes `pairing_repair` audit rows.
- `purgeExpired` 03:30 daily — `emailCodes` past expiry, `rateLimits` older than 1 day, invites past `expiresAt` → `expired` (+ notify sender), visitors unused 18 months with no future entries.

Firestore trigger:
- `onNotificationCreated` — fan-out to push (FCM multicast to `devices`), email (per prefs/digest), sms (adapter no-op). Records `channelsSent`. Retries are idempotent (check `channelsSent` first).

### 9.3 Cancel cascade (exact semantics)

Cancelling `S_A` where `S_A.partner = {member B}`:
1. `S_A.status = 'cancelled'`, clear partner/pairing/substitution fields.
2. `S_B.status = 'looking_for_partner'`, `partner=null`, `pairingId=null`, clear substitution fields.
3. If a member substitute X existed: `S_X.status='cancelled'`, cleared.
4. Notify B (`partner_cancelled`, includes a one-tap "Find a partner" deep link) and X.

Cancelling `S_A` where partner is a visitor: step 1 only; courtesy email to the visitor if opted in.

Cancelling `S_B` where B is `substituted`: B leaves; X becomes A's real partner for this session (`S_A.partner = X`, `S_X.partner = A`, `isSubstituteFor=null`, all substitution fields cleared). If X was a visitor: `S_A.partner = {visitor X}`.

Cancelling `S_X` (a member sub): revert to I2 shape (`clearSubstitute`) and notify A and B.

Cancelling `S_A` where `S_A.teamId` is set (a team member missing one session): only
`S_A` is cancelled; the team is unchanged; notify the captain (`team_member_absent`) with
a one-tap "Add a substitute" link. If A is the captain, the same applies (the captain
role is per series, not per session). A `teamSessionOnly` entry for the same session
remains valid (I9).

## 10. Firestore security rules (spec)

```
helpers:
  callerDoc()      = get(/databases/$(db)/documents/members/$(request.auth.uid)).data
  isActiveMember() = request.auth != null && callerDoc().active == true
  isAdmin()        = isActiveMember() && callerDoc().role == 'admin'
  isSelf(id)       = request.auth != null && request.auth.uid == id
  programmePublished(year) = get(/databases/$(db)/documents/programmes/$(year)).data.status == 'published'

members/{id}             read:  isAdmin() || (isActiveMember() && (resource.data.active == true || isSelf(id)))
                         write: false
memberPrivate/{id}       read:  isSelf(id) && isActiveMember() || isAdmin()
                         write: false
visitors/{id}            read:  isAdmin() || (isActiveMember() && resource.data.createdByMemberId == request.auth.uid)
                         write: false
programmes/{year}        read:  isAdmin() || (isActiveMember() && resource.data.status == 'published')
                         write: false
programmes/{year}/{sub}/{id}
                         read:  isAdmin() || (isActiveMember() && programmePublished(year))
                         write: false
entries/{id}             read:  isActiveMember()          // roster visibility; visitor shows displayName only
                         write: false
teams/{id}               read:  isActiveMember()
                         write: false
invites/{id}             read:  isAdmin() || (isActiveMember() && request.auth.uid in [resource.data.fromMemberId, resource.data.toMemberId])
                         write: false
notifications/{id}       read:  isActiveMember() && resource.data.memberId == request.auth.uid
                         update: same as read && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['read','readAt'])
                                 && request.resource.data.read is bool
                         create, delete: false
auditLog, emailCodes, rateLimits, imports: read/write false   (admins read auditLog through a callable `listAuditLog` with paging — keeps the rules surface minimal)
/{document=**}           read/write false
```

Rules tests (`firebase/functions/rules-test/`) MUST cover every row above with at
least: unauthenticated, inactive member, active member (self), active member (other),
admin. One test file per collection.

Note the `get()` costs: one document read per request for the caller doc (cached
within a single rules evaluation) and one for the programme status on programme
sub-collection reads. Acceptable at club scale; it removes the custom-claims sync
problem entirely.

## 11. Notifications

`notify(memberId, type, { title, body, data })` (functions/src/notifications/notify.ts):
1. Load `memberPrivate` prefs. Always create the `notifications` doc (in-app).
2. The Firestore trigger fans out: push if `prefs.push` and devices exist; email if
   `prefs.email` (immediately, or queued for the daily digest at 17:00 NZ).
3. Failed FCM tokens (`registration-token-not-registered`) are removed from
   `devices`.

Email adapter interface `EmailProvider { send(msg: { to, subject, text, html }) }` with
implementations: `console` (emulator), `postmark`, `sendgrid`, `smtp` (Workspace).
Selected by `EMAIL_PROVIDER`. Templates in `functions/src/email/templates/*.ts`
using a tiny `esc()` helper; every template has a text body. SMS: `SmsProvider`
interface with a `noop` implementation only.

Notification types: `invite_received, invite_accepted, invite_declined,
invite_cancelled, invite_expired, claimed, partner_cancelled, substitute_arranged,
substitute_cleared, matchmaking_alert, session_reminder, on_behalf_action,
team_invite_received, team_member_joined, team_member_declined, team_member_left,
team_member_absent, team_removed, team_captaincy_offered, team_captaincy_transferred,
team_disbanded, broadcast, security` (password set/removed, new device).

## 12. Visitor partners (feature spec)

12.1 **Create.** From the invite/sign-up screen: "Playing with someone who isn't a
member?" → form: name (required), email (optional), phone (optional), "Send them a
confirmation email" (off by default, only enabled if email given). Saved via
`createVisitor`. The member's previous visitors are listed for reuse.

12.2 **Sign up.** `signUpWithVisitor` for one session or a whole series. Creates one
entry per session with `partner = {kind:'visitor', visitorId, displayName}` and a
fresh `pairingId` per session. Conflict on any session → whole call fails with the
list of conflicting dates.

12.3 **Visibility.** Roster and other members' views show "Jane Doe & Bob Visitor
(visitor)". Only the sponsor and admins can open the visitor's details. The visitor
document is never returned to other members by any callable.

12.4 **Contact.** Visitors never receive anything except (opt-in) courtesy emails on
confirmation and cancellation, plain and link-free: "You are down to play with
<sponsor> at Orewa Bridge Club on <date> (<series>). Contact <sponsor> on <phone> if
anything changes." No unsubscribe mechanism is needed because there is no ongoing
sending; but each email states who entered their details and how to ask for removal
(club email address).

12.5 **Promotion.** If a later `importMembers` contains an email equal to a visitor's
email, the import: creates the member as normal, and for every visitor doc with that
email, rewrites future entries' `partner` to `{kind:'member', memberId}` — but does
**not** create mirror entries (the new member never accepted). Instead it notifies
the sponsor: "Bob is now a member — re-invite them so it appears on their card." Then
it deletes the visitor doc. This keeps I2 honest. (Simpler alternative — leave the
visitor pairing as-is — is acceptable if this proves fiddly; note the choice in the
PR.)

12.6 **Limits.** ≤ 20 visitors per member per programme year. Visitor `displayName`
must not collide with an active member's full name (warn, not block).

12.7 **Substitutes** may be visitors (`setSubstitute` with `kind:'visitor'`).

12.8 **A visitor partner cannot be substituted.** Substitution is modelled only for
member–member pairings (I4). If a visitor cannot come, the member cancels the entry
and re-pairs (with a member, another visitor, or the noticeboard). The UI offers
"Change partner" on visitor pairings, which is cancel + sign-up in one step.

## 12A. Teams (feature spec)

12A.1 **Model.** A Teams-format series is entered by teams, not pairs. One team per
captain per series. Team = 4–6 refs (members or the captain's visitors). Members join
for the **whole series**; entries exist per session per member (I9) so the card, roster,
reminders and cancellations work exactly as for pairs.

12A.2 **Captain flow.** On a Teams series: "Start a team" → `createTeam` (captain is
member #1) → "Invite" picker (members) or "Add a visitor" → invites go out
(`scope:'team'`). Team shows `forming` until `teamMin` reached, then `active`; UI warns
the captain if still `forming` 2 days before the first session. Captain can remove
members, transfer captaincy (needs acceptance), or disband.

12A.3 **Member flow.** Invite appears in the same inbox as pair invites, labelled
"Team invite from <captain>". Accept = joined for every session in the series;
conflicts are listed and the accept fails atomically. A member can leave at any time
(future sessions cancelled, captain notified). Missing one session = cancel that
session's entry as usual; the captain is told and can add a session-only substitute.

12A.4 **Noticeboard.** `setSoloStatus` on a Teams session posts "Looking for a team"
/ "Available for a team" and applies to the series. Only a captain whose team has
space may claim; claim = `claimLookingForPartner` which adds the poster for all
sessions. Available = the captain sends a team invite.

12A.5 **Visitors in teams.** Visitor team members appear on the team doc only (no
entries); they are covered by the same 20-per-season cap and privacy rules; courtesy
emails, if opted in, are sent on join and on disband.

12A.6 **Pairs within a team** (who partners whom on the night) are **not** tracked in
v1 — the club sorts that at the table.

12A.7 **Limits/edge cases.** `teamMax` enforced (default 6, series CSV may set
`teamMin`/`teamMax` columns — add them to `series.csv`, optional). A member may be in
only one team per series. Deactivation/erasure removes the member from teams (and
transfers captaincy to the earliest-joined remaining member, notifying them, or
disbands if none). Team docs for a published programme that is later replaced with
`replace:true` are disbanded with notification.

## 13. CSV imports

Unchanged from v1 in format (see `docs/csv-formats.md`, templates in
`shared/templates/`). Additional requirements:

- Parse with `papaparse` (`header: true, skipEmptyLines: true`), reject files > 1 MB
  or > 2 000 rows, reject unknown/missing headers with a clear message before
  processing any row.
- Run entirely as a dry run first (validate every row), then write in batches of
  ≤ 400 inside a single logical import; record the report to `imports/{id}`.
- `series.csv` gains optional `teamMin`, `teamMax` columns (integers; ignored unless
  `format=Teams`; defaults 4 and 6). Update `shared/templates/series.csv` and
  `docs/csv-formats.md`.
- `importMembers` is the only path that creates Auth users. Emails are normalised;
  duplicates within the file are an error. A member is protected from
  deactivation if their email appears *anywhere* in the file, even on a row that
  failed validation. Deactivating more than max(5, 20% of active members) in one
  run requires `allowMassDeactivation: true` (guards against uploading the wrong
  file). Admins are never deactivated by import.
- `importProgramme` on an already-published year requires `replace: true`
  and refuses if any session that would be removed has non-cancelled entries.

## 14. Clients

### 14.1 Web (`web/`)

- React 18, Vite, TypeScript strict, React Router, Firebase JS SDK (modular),
  `vite-plugin-pwa` (Workbox: precache app shell only; **never** cache Firestore
  or function responses), zod (from shared).
- Allowed additional deps: `@tanstack/react-query` (optional), `clsx`. Nothing else
  without justification.
- Hosting headers in `firebase.json`:
  `Content-Security-Policy: default-src 'self'; script-src 'self' https://www.gstatic.com https://www.google.com https://www.recaptcha.net; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.cloudfunctions.net https://*.run.app https://www.google.com; frame-src https://www.google.com https://recaptcha.google.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
  `Strict-Transport-Security: max-age=31536000; includeSubDomains`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- Auth persistence: local (default). No manual token storage. Firestore offline
  persistence **off** by default (shared devices); opt-in toggle later if wanted.
- Accessibility: base font 18px, min tap target 48px, WCAG AA contrast, visible
  focus, no time-limited interactions except the login code (10 min, shown).
- Screens (member): Sign in → My Card → Programme → Session ("who's playing") →
  Team (create/manage/join; visible from a Teams series) → Noticeboard → Invites →
  Notifications → Profile (contact, password, devices, visitors, sign out). Admin (web only): Imports, Programme editor, Members, On-behalf,
  Broadcast, Audit log.
- All admin routes are also guarded server-side; the UI check is cosmetic.

### 14.2 iOS (`ios/`)

- SwiftUI, iOS 17+, Firebase iOS SDK via SwiftPM: Auth, Firestore, Functions,
  Messaging, AppCheck (App Attest, DeviceCheck fallback).
- Keychain persistence (SDK default). Optional Face ID / Touch ID app lock via
  `LAContext` with passcode fallback; default off; toggle in Profile.
- `GoogleService-Info.plist` is **committed** (amended 2026-09-04): it holds the same public values as `web/.env.production` — project id, sender id, app id, API key — and the web already commits those. Nothing in it authorises anything; App Check and rules do. A fresh checkout targets the real project by default, as the web does; the emulator is an opt-in scheme.
- Mirror `shared` types as `Codable` structs in `ios/Shared/Models.swift` with a
  comment pointing to the TS source of truth; keep enum raw values identical.
- Parity with web member screens; no admin screens.
- Universal links are **not** used for auth. Notification deep links carry only ids.

## 15. Repository state and reconciliation of the existing scaffold

Current layout (Phase 0, staged):

```
package.json (workspaces: shared, web, firebase/functions)   eslint.config.js   .prettierrc.json
.github/workflows/ci.yml                                     LICENSE  README.md  .gitignore
shared/{package.json, tsconfig.json, tsconfig.build.json, src/{primitives,enums,models,csv,api,paths,validate,index}.ts, src/validate.test.ts, templates/*.csv}
firebase/{firebase.json, .firebaserc.example, firestore.rules, firestore.indexes.json}
firebase/functions/{package.json, tsconfig.json, vitest*.config.ts, .env.example, src/index.ts, src/lib/{admin,context}.ts, src/index.test.ts, rules-test/{harness,members.rules.test,entries.rules.test}.ts}
firebase/seed/README.md      docs/{data-model,csv-formats,ops-runbook,manual-test-script}.md
```

**Reconciliation edits (do these first, as "Phase 0.5", then commit):**

1. **Runtime → Node 22.** `firebase/firebase.json` `"runtime": "nodejs22"`;
   `firebase/functions/package.json` `"engines": {"node": "22"}`; CI `node-version: 22`;
   add `.mise.toml` at repo root: `[tools]\nnode = "22"\njava = "temurin-21"`.
2. **`shared/src/enums.ts`:** `ENTRY_STATUSES` → `confirmed | looking_for_partner |
   available | substituted | cancelled` (drop `pending_partner`). Add
   `PARTNER_KINDS = ['member','visitor']`, `INVITE_SCOPES = ['session','series']`,
   extend `NOTIFICATION_TYPES` and `AUDIT_ACTIONS` per §11 / §9.2.
3. **`shared/src/models.ts`:** split `Member` → `Member` (public) + `MemberPrivate`;
   add `Visitor`, `PartnerRef`, `Team`; rewrite `Entry` per §5.6 (incl. `teamId`,
   `teamSessionOnly`); `Invite` per §5.7 (scope `team`, `teamId`); `Series` gains
   `teamMin`/`teamMax`; add `RateLimit`, `ImportRecord`; remove `bookable`.
4. **`shared/src/validate.ts`:** replace `pairingMismatchReason` with
   `validatePairingGroup` (I1–I6) and `validateTeamGroup` (I9) in a new
   `shared/src/pairing.ts`;
   add `shared/src/time.ts` (§6). Add `shared/src/schemas.ts` with zod schemas for
   every callable input (§9.2) and for CSV rows. Add `zod` to `shared` deps.
5. **`shared/src/api.ts`:** regenerate contracts from §9.2 (types derive from the zod
   schemas via `z.infer`).
6. **`firebase/firestore.rules`:** rewrite to §10 (read-only, `get()`-based, no client
   entry writes). Delete the `isSelfSolo*` helpers.
7. **`firebase/firestore.indexes.json`:** add `entries(pairingId)`, `entries(teamId, date)`,
   `teams(seriesId, status)`, `teams(captainMemberId)`,
   `entries(memberId, status)`, `visitors(createdByMemberId, lastUsedAt desc)`,
   `invites(status, expiresAt)`, `sessions(date)`; keep existing.
8. **`firebase/functions/src/lib/context.ts`:** keep; ensure `requireMember` reads
   `members/{uid}` (it does) and add `requireAdmin` last-admin helper later.
   Add `lib/rateLimit.ts`, `lib/audit.ts`, `lib/logger.ts` (PII-safe), `lib/secrets.ts`
   (`defineSecret('LOGIN_CODE_PEPPER')`, email keys).
9. **Rules tests:** rewrite `entries.rules.test.ts` to assert **all** client writes
   fail; add `memberPrivate`, `visitors`, `teams`, `programmes` (draft vs published),
   `invites`, `notifications` suites.
10. **`docs/data-model.md`** and **`README.md`:** update to this plan; copy this plan
    to `docs/implementation-plan.md` (already done alongside this file).
11. **CI:** add `npm audit --omit=dev --audit-level=high` and a gitleaks step; use
    `npm ci`.
12. **Commit** Phase 0 + 0.5 as one commit: "Scaffold: monorepo, shared model, rules, functions skeleton".

## 16. Build phases and definition of done

| Phase | Scope | Definition of done |
|---|---|---|
| **0.5 Reconcile** | §15 | Build/lint/typecheck/tests green; rules tests green in emulator; committed. |
| **1 Members & auth** | `importMembers`, blocking functions, `requestLoginCode`/`verifyLoginCode`, password set/remove, `updateMyContact/Prefs`, `registerDevice`, rate limiter, email adapter (`console` + one real provider), seed script (demo-only guard), web: sign-in, profile, admin members import | Unit tests: code lifecycle (CSPRNG, HMAC, TTL, attempts, single-use, uniform response), rate limits, import (add/update/deactivate/dup/oversize), blocking fn deny. Manual: §17 steps 1–2. |
| **2 Programme** | `importProgramme`, `publishProgramme`, web programme browser + session page (read-only), iOS project + sign-in + programme browser | Tests: import dry-run/validation/ids; draft invisible to members (rules test); published visible. iOS builds and signs in against the emulator. |
| **3 Card core** | `sendInvite` (session+series), `respondToInvite`, `cancelInvite`, `cancelEntry` cascade, `setSoloStatus`, `claimLookingForPartner`, roster + My Card + invites (web + iOS) | **Invariant tests** for every mutation path (I1–I7) incl. series accept with conflicts, double-accept race (two transactions), locked session refusal. |
| **4 Visitors & substitutes** | `createVisitor/update/delete`, `signUpWithVisitor`, `setSubstitute/clearSubstitute`, individual-series repeat warning, promotion on import (§12.5) | Invariant tests I3, I4 all shapes (member sub, visitor sub, cancel by each of A/B/X); visitor visibility rules tests; 20-visitor cap. |
| **4b Teams** | `createTeam`, `inviteToTeam`, team-scope `respondToInvite`, `addVisitorToTeam/remove`, `leaveTeam`, `removeFromTeam`, `transferCaptaincy`, `disbandTeam`, team session substitutes, Teams-series noticeboard/claim, Team screen (web + iOS) | Invariant tests for I9 across every path (join, leave, remove, disband, transfer, session absence + session-only sub, captain absence, deactivation of a captain); `teamMax` enforced; only captain may mutate (permission tests); conflict-on-accept lists dates. |
| **5 Notifications** | `notify`, trigger fan-out, FCM (iOS + web push), email templates, digest, reminders, `purgeExpired`, notification prefs UI | Tests: fan-out idempotency, dead-token pruning, digest batching, template escaping (name `<script>` renders escaped), reminder day maths in NZ TZ across DST change (late Sept / early Apr). |
| **6 Admin & integrity** | on-behalf across all callables (+ member notification), `setMemberRole` (last-admin guard), `deactivate/reactivate`, `eraseMember`, `updateSeries/Session`, `broadcast`, `listAuditLog`, `verifyPairingConsistency` + `runPairingSweep` + repair, admin web UI | Tests: on-behalf audit + notify for each callable; last-admin guard; erase scrubs PII everywhere incl. visitors and denormalised `displayName`; sweep detects each violation class and repairs deterministically. |
| **7 Hardening & pilot** | App Check enforcement on, CSP verified, Face ID lock, PWA install guide, accessibility pass, TestFlight, backups + budget alert configured, privacy statement page, one-weekday pilot | Security checklist (§18) signed off; Playwright E2E green; pilot exit criteria met. |

## 17. Verification

- **Unit (vitest):** `shared` (pure helpers, `validatePairingGroup`, time helpers,
  zod schemas) and `functions` (each callable via `firebase-functions-test` against
  the emulator; email adapter `console`).
- **Rules (`@firebase/rules-unit-testing`):** full matrix per §10.
- **Invariant suite:** `functions/src/entries/__tests__/invariants.test.ts` builds
  every state in §7 through the public callables and asserts `validatePairingGroup`
  and `validateTeamGroup` are empty after each step and that the sweep finds nothing.
- **Concurrency:** two `respondToInvite`/`claimLookingForPartner` calls racing for
  the same member/session; exactly one succeeds.
- **Web (vitest + RTL; Playwright E2E)** against the emulator: sign in by code →
  browse → invite → accept → both cards match → cancel → partner is LFP → claim →
  visitor sign-up → substitute → admin on-behalf shows in audit log.
- **iOS (XCTest):** view-model tests against the emulator; TestFlight smoke.
- **Manual script:** `docs/manual-test-script.md` (update for visitors + substitutes).
- **Security checks in CI:** `npm audit` (prod deps, high+), gitleaks, rules tests,
  a test asserting `firestore.rules` contains no `allow create|update|delete` other
  than the notifications `update` line (string-level guard against regression).

## 18. Security checklist (gate before pilot)

- [ ] `beforeUserCreated` denies; `beforeSignIn` requires active; verified in emulator with a client-side `createUserWithEmailAndPassword` attempt.
- [ ] Email enumeration protection ON; password policy ON (Firebase console).
- [ ] App Check enforced on callables + Firestore; iOS App Attest; web reCAPTCHA Enterprise; debug tokens only in emulator.
- [ ] Secrets in Secret Manager; none in repo or CI logs (`grep -r` for pepper/keys).
- [ ] Rules: no client writes except notifications.read (automated guard test).
- [ ] `memberPrivate` and `visitors` unreadable by other members (rules tests).
- [ ] Login-code emails contain no links; wording reviewed.
- [ ] Rate limits observed under a scripted 50-request burst.
- [ ] Logs reviewed for PII after running the E2E suite.
- [ ] CSP has no `unsafe-eval`; `'unsafe-inline'` only on styles; report-only run showed no violations.
- [ ] Firestore backups scheduled; restore rehearsed once in the dev project.
- [ ] Budget alert set; `maxInstances` pinned.
- [ ] Privacy statement published in-app; `eraseMember` tested.
- [ ] Deactivated member loses access within one token refresh (tested).

## 19. Ops notes

- Environments: `demo-obc` (emulator only), `obc-dance-card-dev`, `obc-dance-card` (prod, Blaze, budget alert NZ$5).
- First admin: import members, then set one `role: 'admin'` via a one-off Admin-SDK script (`firebase/scripts/make-admin.ts`, requires a service account, never committed) — not via the console by hand, so it is repeatable and audited.
- Email: prefer the Workspace SMTP route ($0) unless deliverability is poor; then Postmark.
- Java (temurin 21) is required locally for the emulator; `.mise.toml` pins it.

## 20. Open items (the only undecided things)

Resolved 2026-08-29 with the club: **Teams** are in scope with a captain-invites model
(§12A); **claim semantics** as specified (§2 Matchmaking); **email provider** = build
`smtp` (Google Workspace) first, Postmark as fallback.

Still open:

1. **Visitor promotion (§12.5)** — full rewrite vs. leave-as-is. Default: implement
   the notify-and-delete approach; fall back if it becomes complex.
2. **Digest time** 17:00 NZ — confirm.
3. **Team defaults** `teamMin=4`, `teamMax=6` — confirm against how the club actually
   runs its Teams events.

## 21. Backlog — requested enhancements (captured 2026-09-04, not yet scheduled)

These are member-experience features Neil requested after the core build. They are
**not** yet implemented and not assigned to a phase. Each entry records the intent and
a sketch of the approach so an implementer can pick it up; treat the sketches as
SHOULD, not settled decisions, and confirm the open questions before building.

### B1. iCal subscription feed

> **Status: implemented 2026-09-04.** Built to the settled security design in
> this section's implementer brief, which superseded the sketch below where
> the two differed. Deviations and settled open questions, for the record:
>
> - **Open question "toggle for unbooked sessions?" settled: no toggle, one
>   merged feed.** `confirmed`/`substituted` entries appear as normal
>   `VEVENT`s; `looking_for_partner`/`available` appear too, but as
>   `STATUS:TENTATIVE` with a "(looking for a partner)"/"(available)" suffix
>   on `SUMMARY` — a calendar client's own UI already renders `TENTATIVE`
>   events distinctly, so this reads as "maybe" without needing a second feed
>   or a per-feed setting. `unavailable`/`cancelled` are never included.
> - **Open question "separate feed per year or combined?" settled: one
>   combined feed** — the query is `entries(memberId, date)` with no year
>   filter (today − 30 days onward), so every published year's sessions
>   appear together automatically as new years publish.
> - **Deviation: the token's plaintext is stored, not hashed-only**, on
>   `memberPrivate.icalToken` (§5.2) — the sketch said "store hashed only".
>   The owner must be able to redisplay their subscription URL (rotating on
>   every view would break existing calendar-app subscriptions, exactly like
>   Google Calendar's re-displayable "secret address"); `memberPrivate` is
>   already owner+admin read-only via rules and written only by callables, so
>   this is no weaker than the account's existing confidentiality. The
>   server-only, sha256-keyed `icalTokens/{hash}` doc (§5.10) is what the
>   unauthenticated feed endpoint actually looks up — an O(1) lookup that
>   never round-trips the plaintext token through a query.
> - Four callables (`getIcalFeed`, `createIcalFeed`, `rotateIcalFeed`,
>   `removeIcalFeed`, §9.2), one `onRequest` HTTP endpoint (`icalFeed`, mounted
>   at `/ical/**` by a Hosting rewrite), a pure RFC 5545 builder
>   (`firebase/functions/src/ical/ics.ts`, unit-tested: escaping, line
>   folding incl. multibyte, a full-calendar snapshot, TENTATIVE mapping), and
>   a Profile "Calendar feed" card (`web/src/screens/CalendarFeedCard.tsx`).
>   See §8.1's new threat-model row for the endpoint's specific controls.

**Intent.** A member can subscribe to their own bridge schedule from Apple Calendar or
Google Calendar, so booked sessions (and optionally sessions they are still looking to
fill) appear alongside the rest of their life. Read-only, auto-refreshing.

**Sketch.**
- An HTTPS Cloud Function (`onRequest`, not callable) that emits `text/calendar`
  (RFC 5545). One `VEVENT` per non-cancelled entry for the member, with `DTSTART`/
  `DTEND` in `Pacific/Auckland` (VTIMEZONE block or UTC with the offset resolved via
  the §6 helpers), `SUMMARY` = series/session title + partner name, `LOCATION` = the
  club, `UID` = the deterministic entry id, `LAST-MODIFIED` from `updatedAt`.
- **Auth without a login.** Calendar clients cannot do App Check or Firebase Auth, so
  the feed is authorised by an unguessable per-member token in the URL
  (`/ical/{feedToken}.ics`). Store a CSPRNG `feedToken` (hashed) in `memberPrivate`;
  expose "Subscribe to my calendar" in Profile that reveals the URL and a "reset link"
  action (rotates the token, invalidating the old URL). Token grants read of that one
  member's schedule only. Rate-limit by token. Document that the URL is a secret.
- Decide scope: confirmed sessions only, or also `looking_for_partner`/`available`
  (probably a toggle). No PII of other members beyond partner display name.
- This is the one deliberate exception to "clients only read Firestore / everything
  else is a callable" — it is an unauthenticated read endpoint, so it must be
  especially careful: token-scoped, no enumeration, minimal data.

**Open.** Both questions below are settled — see the status note above.
~~Include unbooked/available sessions?~~ ~~Separate feed per year or one combined?~~

### B2. Bulk day/weekday availability ("I never play Mondays")

> **Status: backend implemented 2026-09-04.** The sketch below is superseded
> by the settled semantics actually built: `unavailable` blocks exactly like
> `confirmed`/`substituted` for every "is this member free" precondition
> (`entries/lib.ts#isFree` — any non-cancelled entry blocks; no change needed
> there) — it is *not* excluded from blocking the way it is excluded from the
> noticeboard and card display. `sendSessionReminders` skips it. The new
> callable is `setBulkSoloStatus({ status: 'available'|'unavailable'|'clear',
> filter: { weekdays[], fromDate?, toDate? }, onBehalfOfMemberId? })` —
> deliberately no raw `sessionIds[]`/`year` variant, since the weekday/date
> filter is the whole feature. It expands the filter across every *published*
> programme year (there is no cross-year index, so this iterates years),
> capped at 200 matching sessions (`failed-precondition` above that — narrow
> the range). A booked entry (`confirmed`/`substituted`, including a Teams
> member's roster entry) is skipped and reported, never overwritten; a solo
> entry (`looking_for_partner`/`available`/`unavailable`), `cancelled`, or
> absent entry is freely upserted (`clear` → `cancelled`; entries are never
> deleted). This is a **one-time bulk action** the member re-runs as needed —
> no standing "never Mondays" rule that auto-applies to a newly published
> year (Neil's call, §21 "Open" below). See
> `firebase/functions/src/entries/bulkSoloStatus.ts`.
>
> **Status: web UI implemented 2026-09-04**, alongside B4 (they share one
> screen). "Set availability…" lives on the new `/calendar` screen (B4 below)
> as a button opening a dialog: status radios (Available/Unavailable/Clear,
> each with a one-line explanation), Mon-Fri weekday checkboxes, native
> `<input type=date>` from/to (default today → end of the newest loaded
> year), and a live client-side preview (`web/src/lib/bulkAvailability.ts`,
> pure and unit-tested) mirroring the server's weekday/date-range/bookable
> filtering — deliberately not the lock check or 200-cap, which the plan
> settles the server owns; the preview says "about N". Confirm calls
> `setBulkSoloStatus` and shows `updated`/`skipped` in plain English. The
> session page (`SessionScreen`) also grew a same-callable single-session "I'm
> unavailable" action next to "I'm available"/"I'm looking for a partner", and
> `deriveSessionActions` (`web/src/lib/sessionActions.ts`) got a dedicated
> `unavailable` state — it previously fell through to the `confirmed` branch
> and would have mis-rendered a solo `unavailable` marker as a real booking.

**Intent.** Select many sessions at once and set a solo status across all of them —
e.g. mark every Monday as unavailable for the season, or mark a run of dates
available in one action.

**Sketch.**
- Introduce an explicit **`unavailable`** solo status (today §5.6 has
  `looking_for_partner` / `available` but no "do not offer me"). Add it to
  `ENTRY_STATUSES`, the validators (still a solo status under I6), rules, and UI.
  `unavailable` = "don't show me on the noticeboard, don't send me matchmaking alerts
  for this session"; it is not a booking.
- New callable `setBulkSoloStatus({ sessionIds[] | filter, status })` where `filter`
  can be `{ weekday, fromDate?, toDate?, year? }`. Server expands the filter to the
  concrete bookable, unlocked session ids, skips any session where the member already
  has a non-cancelled *booked* entry (never silently overwrite a real pairing —
  return those as skipped), and upserts entries transactionally in batches (§13 batch
  limits). Cap the number of sessions per call.
- UI: on the Programme / month view, a "Set availability…" mode with weekday and date
  filters, a preview of how many sessions will change and which are skipped, then
  confirm. Must be reversible (clear back to no-entry).

**Resolved 2026-09-04.** `unavailable` suppresses reminders (yes). No standing
"never Mondays" rule — this is a one-time bulk action the member re-runs each
year, as leaned above. A standing rule remains a bigger, unscheduled feature if
wanted later.

### B3. Hide past events by default + two-year (this year + next year) horizon

> **Status: implemented 2026-09-04.** `ProgrammeProvider` loads the 3 newest
> published years (per-year subscriptions merged client-side, every item
> year-tagged — `seriesId`/weekday ids collide across years, session ids don't);
> `useProgramme(year)` returns a year slice; ProgrammeScreen hides past
> standalone sessions and fully-past series by default behind a "Show earlier
> sessions" toggle (rendered only when something is hidden). "Show past" reach =
> whatever is loaded (up to 3 published years). Server side needed no changes;
> a test now pins that publishing one year never unpublishes another. Seed
> publishes a second, current-dated year; e2e `programme-horizon.spec.ts` covers
> the merge, the toggle, and cross-year navigation.

**Intent.** (a) Don't show sessions before today by default, with a way to reveal
earlier ones. (b) Show this year's remaining sessions **and** next year's, because the
new programme is published before the current year ends and members book across the
boundary.

**Sketch.**
- **Past hiding is a view concern, not a data change.** Default every list/calendar to
  start at `todayNZ()`; add a "Show past" affordance (a toggle or a "‹ earlier"
  control) that widens the range. Past sessions remain locked (I7) — read-only.
- **Two-year horizon.** The data model already keys programmes by year
  (`programmes/{year}`) and sessions already carry an absolute `date`. The work is to
  make the clients query and merge **multiple published programme years** (current and
  next) into one chronological stream, rather than assuming a single active year.
  - Prefer querying sessions by `date >= todayNZ()` across published years and merging,
    over the plan's throwaway idea of "augmenting this year's programme with next
    year's" — keep programmes as separate year documents (cleaner import/publish,
    §13's `replace:true` still works per year) and merge in the read layer.
  - Confirm `importProgramme`/`publishProgramme` and the CSV flow already allow a
    future year's draft to exist and be published while the current year is still
    active (they should — year is a parameter — but verify and add a test).
  - Reminders, iCal (B1), and the overview (B4) all consume the same merged,
    from-today stream.

**Open.** How far back should "Show past" reach — whole current year, or all history?

### B4. Calendar overview: month view, list mode, year heat-map

> **Status: implemented 2026-09-04.** New `/calendar` screen ("Calendar" in
> the member nav, My Card left untouched), sharing `useProgramme()` (B3) and a
> new `useMyEntries()` hook extracted from `HomeScreen` so both screens read
> one live `entries` subscription. Pure view-model in `web/src/lib/overview.ts`
> (heavily unit-tested): a six-way day taxonomy — `none` (no bookable session,
> or the day is past — always muted), `booked` (every session that day
> booked), `partly` (some but not all), `seeking` (not booked, but a
> looking_for_partner/available entry that day), `unavailable` (every session
> that day covered by an `unavailable` entry — partial coverage reads as
> `open` instead, per the settled rule below), `open` (a bookable session
> with no active relationship — the state the year view exists to surface).
> Three modes behind a weekday-tabs-style segmented control: **List**
> (default, next 14 days, "Show more", days with nothing omitted), **Month**
> (Mon-Fri grid only — the programme never runs weekends — prev/next bounded
> by the loaded years, today outlined), **Year** (a picker over loaded years,
> 12 compact month blocks, a legend). Every status is colour *and* a letter
> glyph (never colour alone, WCAG 1.4.1); Year-view day cells are deliberately
> smaller than the app's usual 48px tap target (12 months of Mon-Fri cells
> would not otherwise fit on a phone) — a documented, conscious exception for
> this one dense "spot the pattern" view, not the Month/List views. Clicking a
> single-session day cell opens that session; a multi-session cell (or any
> Year-view cell) jumps to List anchored at that date. See
> `web/src/screens/CalendarScreen.tsx`, `web/src/lib/overview.ts`,
> `web/src/entries/useMyEntries.ts`; e2e in `web/e2e/calendar.spec.ts`.
>
> Loose ends fixed along the way: `web/src/screens/InvitesScreen.tsx` had an
> un-year-qualified `series.find` (a latent bug from B3's `seriesId`
> collision-across-years risk, since fixed by deriving the year from the
> invite's own session dates).

**Intent.** See the schedule at a glance, not one day at a time. Specifically: the next
~two weeks; a month grid; a list mode as an alternative to the grid; and a whole-year
overview colour-coded per day so a member can spot dates they are *available for but
have not booked*.

**Sketch.**
- A new **Overview** screen (member) with three modes sharing one from-today, two-year
  (B3) data source:
  1. **Agenda/list** — chronological list of upcoming sessions with the member's status
     per session (booked-with-whom / looking / available / unavailable / nothing).
     Default to the next two weeks with "show more".
  2. **Month grid** — a calendar month; each day cell shows its session(s) and the
     member's status, with prev/next month.
  3. **Year heat-map** — 12 compact month blocks; each day colour-coded by the member's
     relationship to that day's sessions. Suggested legend: **booked**, **partially
     booked** (some sessions that day booked, some not), **open** (a session exists the
     member could book but hasn't), **unavailable**, **no session / past**. The point
     is to make "open" days pop so members fill gaps.
- All derived client-side from the entries + sessions the member can already read; no
  new write path. Colours must meet WCAG AA and not rely on hue alone (§14.1
  accessibility) — pair colour with an icon/label, important for an elderly user base.

**Open.** Exact status→colour taxonomy; whether "open" should exclude sessions whose
series the member is ineligible for (grade notes are advisory, §2, so probably show
them but flag).

### B5. Admin: sign-up counts per event

**Intent.** In admin mode, see how many pairs (and teams) have signed up for each
session/series, to gauge turnout and chase low numbers.

**Sketch.**
- Admin Programme view gains a count per session: **pairs** = non-cancelled member
  entries that are `confirmed` with a partner, counted as pairs (member–member counted
  once per pairing via `pairingId`; member–visitor counted as one pair), plus a
  separate **teams** count (distinct `active`/`forming` `teamId`s with sessions that
  day) and a **solo/looking** count.
- Also surface a per-series roll-up. Prefer computing via a callable
  (`getSignupCounts({ year, weekday? | seriesId? })`) that aggregates server-side and
  returns only counts (no rosters beyond what admins can already see), rather than
  pulling every entry to the client. Consider a denormalised counter on the session
  doc updated by the entry-mutation callables if live counts on the member-facing
  session page are wanted later; start with on-demand aggregation.

**Open.** Live (denormalised counters) vs. on-demand aggregation — start on-demand.

> **Status: implemented 2026-09-04.** Deviated from the sketch above: no
> `getSignupCounts` callable was added, and no functions/rules/index changed.
> `ProgrammeEditor` already subscribed to the whole selected year's `entries`
> (a date-range query on the top-level collection) to compute the bare
> non-cancelled count it fed `SessionEditDialog`'s `activeEntryCount` — so a
> callable would have added a round trip and a second source of truth for
> data the client already has. B5 is a pure client-side aggregation
> (`web/src/lib/signupCounts.ts`: `sessionSignupCounts`,
> `formatSignupSummary`, `seriesSignupRange`) over that same subscription —
> counts are live, updating as entries change, with no polling or extra
> reads. Also added a "One-off sessions" card (standalone `seriesId == null`
> sessions, sorted by date) to the editor, since Holiday Bridge/other
> standalone sessions had no row anywhere in the admin editor before this —
> a real gap, not scoped by the original sketch but a natural extension of
> the same per-session aggregation. `noBridge` sessions show "—" (they take
> no sign-ups) rather than "No sign-ups yet".

### B6. Push: move from FCM registration tokens to Firebase Installation IDs (captured 2026-09-05)

**Intent.** Firebase Messaging (iOS SDK 12.18) has deprecated every
registration-token API (`token()`, `deleteToken()`, `fcmToken`, the per-sender
variants) in favour of registering the *app instance* with FCM by its Firebase
Installation ID (FID): `register(completion:)` / `unregister(completion:)`, opted
in with `FirebaseMessagingInstallationIdEnabled = YES` in `Info.plist`. Once that
flag is on, the token APIs fail outright, so this is a switch, not a gradual
migration.

**Why not now.** Push is token-addressed end to end (§11, §14.2): the server
sends by token (`registerDevice { token, platform, label }` →
`memberPrivate.devices[].token` → Admin SDK `send`/`sendEach` to tokens), and
the web client registers tokens too. Switching iOS alone would leave the
server unable to address it. Until the Admin SDK and the web SDK can target
FIDs on the same footing, iOS deliberately keeps the deprecated calls
(`ios/OBCDanceCard/App/PushManager.swift`) and the two build warnings stay
visible rather than being papered over.

**Sketch (when picked up).**
- `devices[]` gains `fid?: string` alongside `token`; `registerDevice` accepts
  either; the sender prefers `fid` where the Admin SDK supports it and falls
  back to `token`.
- iOS: set the plist flag, replace `token()`/`deleteToken()` with
  `register()`/`unregister()`, adopt `messaging(_:didReceiveRegistration:)` /
  `messaging(_:didUnregister:)`; the stored-token / sign-out semantics are
  unchanged.
- Web follows whenever `firebase/messaging` offers the equivalent; until then
  it stays on tokens and the server handles both.
- No change to what a push carries (ids only, §14.2) or to the permission
  rules (never auto-prompt).

### Cross-cutting notes for the backlog

- **B3 is a prerequisite** for B1, B4, and the value of B2 (bulk-setting across the
  year boundary), so schedule it first if these are picked up together.
- **B2's `unavailable` status** and **B4's "open" colour** are two halves of the same
  idea (what am I free for?) — design them together.
- None of these change the security model except **B1**, which adds the first
  token-authenticated unauthenticated read endpoint; give it its own threat-model row
  (token entropy, rotation, rate-limiting, minimal payload, no enumeration) before it
  ships.

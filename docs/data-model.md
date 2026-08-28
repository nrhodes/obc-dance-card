# Data model

Authoritative types live in [`shared/src/models.ts`](../shared/src/models.ts);
this document is the narrative overview. Collection paths come from
[`shared/src/paths.ts`](../shared/src/paths.ts). Invariants are enforced by
[`shared/src/pairing.ts`](../shared/src/pairing.ts) (`validatePairingGroup`,
`validateTeamGroup`) — see [`docs/implementation-plan.md`](implementation-plan.md)
§5–§7 for the full spec.

**Clients never write Firestore directly**, with exactly one exception: a
member may toggle `read`/`readAt` on their own `notifications` doc. Every
other mutation goes through a Cloud Functions callable, which validates,
authorises, and writes inside a transaction. See `firestore.rules`.

## Collections

### `members/{memberId}`

`memberId` **is the Firebase Auth uid**. Created only by the `importMembers`
callable. Public-to-members profile: `firstName`, `lastName`, `phone`,
`grade`, `role` (`member`/`admin`), `active`, `lastImportId?`. No email, no
tokens — those live in `memberPrivate`. Any active member may read any other
*active* member (booklet parity: name, grade, phone); a member always reads
their own doc regardless.

Members are never hard-deleted; leaving the club sets `active: false`.
`eraseMember` scrubs PII entirely (NZ Privacy Act) after 30+ days inactive.

### `memberPrivate/{memberId}` — owner + admin only

`emailLower` (the login identity), `notificationPrefs`, `devices` (push
tokens, max 10), `hasPassword`, `lastLoginAt?`. Split out from `members` so
that email addresses and device tokens are never exposed to other members.

### `visitors/{visitorId}` — sponsor + admin only

A non-member partner a member can pair with: `displayName`, optional
`email`/`phone`, `createdByMemberId`, `courtesyEmails` opt-in, `lastUsedAt`.
Visitors never have an Auth account and can never sign in. Other members see
only the denormalised `displayName` on an entry's `partner`/`substitute`
field — never this document.

### `programmes/{year}`

One document per season (`id` = `"2027"`). `status` is `draft` until an admin
publishes it; members only ever see `published` programmes (enforced by
`programmePublished(year)` in the rules, checked with `get()`).

Sub-collections (all gated on the parent programme's publish status for
non-admins):

- **`weekdays/{weekday}`** — session time, "seated by" time, the Partner
  Steward, and any per-day note ("No partner required" for Tuesday juniors).
  `id` is the weekday name.
- **`series/{seriesId}`** — a named multi-week event: scoring (`Scr`/`Hcp`),
  format (`Pairs`/`Teams`/`Individual`), optional "best N from M", whether a
  one-week substitute is allowed, free-text eligibility/general notes, the
  generated `sessionIds`, and (Teams only) `teamMin`/`teamMax` (default 4/6).
- **`sessions/{sessionId}`** — one dated occurrence. `kind` is `series`,
  `holidayBridge`, or `noBridge`. Whether a session can still be booked is
  *computed* (`kind !== 'noBridge' && date >= todayNZ()`), never stored.
  Series name / scoring / format are denormalised for list rendering.

### `entries/{sessionId}_{memberId}`

One member's dance-card entry for one session. The document id is
**deterministic** — one entry per member per session, by construction.
Statuses: `confirmed`, `looking_for_partner`, `available`, `substituted`,
`cancelled`.

Partners (member or visitor) are represented by a denormalised `PartnerRef`
(`{kind, memberId|visitorId, displayName}`) so rosters render without a
lookup and without ever exposing a visitor document.

**Bidirectional invariant (I1–I6).** A `confirmed` member/member pairing
always has an exact mirror on the partner's card, sharing `pairingId`. A
visitor pairing is one-sided (`pairingId` set but not shared). A one-week
substitute sets `substitute`/`partnerSubstitute` on the two sides of the
pairing and `isSubstituteFor` on the substitute's own entry. Team members
(Teams-format series) have `teamId` set, `partner`/`pairingId` null, and no
substitution fields (I9); a `teamSessionOnly` entry covers one team member's
one-off absence. All of this is written by a single Cloud Function
transaction that re-validates with `validatePairingGroup`/`validateTeamGroup`
before committing — clients cannot write `entries` at all.

### `teams/{teamId}` — Teams-format series

One team per captain per series (`teamId = ${seriesId}-${captainMemberId}`).
`members: Array<{ref: PartnerRef; joinedAt}>` includes the captain; may
include visitors (visitor team members have no `entries` doc). `status`:
`forming` → `active` (once `teamMin` reached) → `disbanded`. Readable by all
active members (roster parity); writable only by callables.

### `invites/{inviteId}`

The invite → accept/decline handshake, covering a session, a whole series
sign-up, or (captain-issued) a team. Written only by callables. Readable by
the two participants and admins.

### `notifications/{notificationId}`

Per-member feed item; also the fan-out record (`channelsSent`, including
`inapp`). Owner may flip `read`/`readAt` and nothing else — the one
client-writable path in the whole schema.

### `auditLog/{logId}`, `emailCodes/{id}`, `rateLimits/{id}`, `imports/{id}` — server-only

- **`auditLog`** — every admin on-behalf action, role change, deactivation,
  import, publish, broadcast, and automated pairing repair. Admin-readable
  only through the paged `listAuditLog` callable, never directly.
- **`emailCodes/{sha256(emailLower)}`** — hashed 6-digit login codes
  (`codeHmac`), expiry, attempt count.
- **`rateLimits/{bucket}:{sha256(subject)}`** — fixed-window counters backing
  `assertRateLimit`.
- **`imports/{importId}`** — a record of one member or programme import run.

None of these four collections are ever readable or writable by a client.

## Key queries and their indexes

| Screen | Query | Index |
|---|---|---|
| My Dance Card | `entries where memberId == uid and date >= today` | `entries(memberId, date)` |
| Noticeboard | `entries where status in (...) and date >= today` | `entries(status, date)` |
| Session roster | `entries where sessionId == s and status == confirmed` | `entries(sessionId, status)` |
| Pairing lookup (sweep/repair) | `entries where pairingId == p` | `entries(pairingId)` |
| My status by session | `entries where memberId == uid and status == s` | `entries(memberId, status)` |
| Team roster over time | `entries where teamId == t orderBy date` | `entries(teamId, date)` |
| Teams in a series | `teams where seriesId == s and status == st` | `teams(seriesId, status)` |
| My teams (as captain) | `teams where captainMemberId == uid` | `teams(captainMemberId)` |
| My visitors, recent first | `visitors where createdByMemberId == uid orderBy lastUsedAt desc` | `visitors(createdByMemberId, lastUsedAt desc)` |
| Expiring invites (sweep) | `invites where status == pending orderBy expiresAt` | `invites(status, expiresAt)` |
| Invites inbox | `invites where toMemberId == uid and status == pending` | `invites(toMemberId, status, createdAt)` |
| Notifications | `notifications where memberId == uid orderBy createdAt desc` | `notifications(memberId, createdAt)` |
| Programme by day | `sessions where weekday == d orderBy date` | `sessions(weekday, date)` |
| Sessions on a date (reminders) | `sessions where date == d` | `sessions(date)` |

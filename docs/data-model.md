# Data model

Authoritative types live in [`shared/src/models.ts`](../shared/src/models.ts);
this document is the narrative overview. Collection paths come from
[`shared/src/paths.ts`](../shared/src/paths.ts).

## Collections

### `members/{memberId}`

`memberId` **is the Firebase Auth uid**. The document is provisioned on first
sign-in by copying the matching row from the admin-loaded allowlist (matched on
`emailLower`). `role` and `active` are also written to custom claims so security
rules avoid an extra read.

Members are never hard-deleted; leaving the club sets `active: false`.

### `programmes/{year}`

One document per season (`id` = `"2027"`). `status` is `draft` until an admin
publishes it; members only ever see `published` programmes.

Sub-collections:

- **`weekdays/{weekday}`** — session time, "seated by" time, the Partner Steward,
  and any per-day note ("No partner required" for Tuesday juniors). `id` is the
  weekday name.
- **`series/{seriesId}`** — a named multi-week event: scoring (`Scr`/`Hcp`),
  format (`Pairs`/`Teams`/`Individual`), optional "best N from M", whether a
  one-week substitute is allowed, and free-text eligibility / general notes.
- **`sessions/{sessionId}`** — one dated occurrence. `kind` is `series`,
  `holidayBridge`, or `noBridge`. `noBridge` dates are shown but not bookable.
  Series name / scoring / format are denormalised for list rendering.

### `entries/{entryId}`

One member's dance-card entry for one session. Statuses: `confirmed`,
`pending_partner`, `looking_for_partner`, `available`, `cancelled`.

**Bidirectional invariant.** A `confirmed` entry always has an exact mirror on the
partner's card — `memberId`/`partnerMemberId` swapped, same `pairingId`. Both
halves are written together in a Cloud Function transaction. Clients may only
create/modify their own **solo** entry (`looking_for_partner` / `available`, or
cancelling one that is still solo); the security rules forbid a client from ever
setting `partnerMemberId`, `pairingId`, or `status: confirmed`.

A one-week substitute sets `substituteMemberId` on the covered member's entry and
mirrors it onto the partner's entry (both sides show the sub for that week);
`isSubstituteFor` is set on the substitute's own entry.

### `invites/{inviteId}`

The invite → accept/decline handshake. Written only by callables. Readable by the
two participants and admins.

### `notifications/{notificationId}`

Per-member feed item; also the fan-out record (`channelsSent`). Owner may flip
`read`/`readAt` and nothing else.

### `auditLog/{logId}`

Every admin on-behalf action and every automated pairing repair. Admin-readable,
never client-writable.

### `emailCodes/{codeId}`

Hashed 6-digit login codes with expiry + attempt count. Server-only; no client
access at all.

## Key queries and their indexes

| Screen | Query | Index |
|---|---|---|
| My Dance Card | `entries where memberId == uid and date >= today` | `entries(memberId, date)` |
| Noticeboard | `entries where status in (...) and date >= today` | `entries(status, date)` |
| Session roster | `entries where sessionId == s and status == confirmed` | `entries(sessionId, status)` |
| Invites inbox | `invites where toMemberId == uid and status == pending` | `invites(toMemberId, status, createdAt)` |
| Notifications | `notifications where memberId == uid orderBy createdAt desc` | `notifications(memberId, createdAt)` |
| Programme by day | `sessions where weekday == d orderBy date` | `sessions(weekday, date)` |

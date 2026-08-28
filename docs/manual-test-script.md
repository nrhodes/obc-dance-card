# Manual end-to-end test script

Run against the emulator with seed data loaded. This is the acceptance walk-through
referenced in the plan; automate the high-value paths with Playwright as features
land.

## Setup

1. `npm run emulators` and `npm run seed -w @obc/functions`.
2. Open the web app. Note the seeded admin address and two ordinary members
   (one will use a password, one the emailed code).

## 1. Admin brings in data (Phase 1–2)

- [ ] Sign in as the admin.
- [ ] Import `members.csv` — report shows the expected added/updated counts.
- [ ] Re-import with one member removed — that member is marked inactive, not
      deleted; they can no longer sign in.
- [ ] Import the three programme CSVs for 2027 into a draft, review, publish.
- [ ] A non-admin cannot see the draft before publish; can after.

## 2. Login (Phase 1)

- [ ] Member A: set a password, sign out, sign back in with it.
- [ ] Member B: request a 6-digit code, receive it (emulator log / mailbox),
      sign in. An expired or wrong code is rejected; too many attempts locks out.
- [ ] An email not on the allowlist gets the generic "check your email" response
      and no account is created.

## 3. Invite and accept (Phase 3)

- [ ] Member A opens a Monday session, invites Member B.
- [ ] Member B sees the invite (in-app + notification), accepts.
- [ ] **Both** cards now show the pairing for that session; the session roster
      lists them as a confirmed pair.
- [ ] Member A tries to invite someone else for the same session — blocked
      (already paired).

## 4. Cancel and re-match (Phase 3–4)

- [ ] Member A cancels that session.
- [ ] Member B is notified and their entry flips to "Looking for Partner"; A's
      entry is "cancelled" and no longer shown as active.
- [ ] Member C sees B on the noticeboard and pairs with them; both cards match.

## 5. Substitute (Phase 4)

- [ ] For a confirmed pair in a substitute-allowed series, the remaining player
      records Member D as a one-week substitute.
- [ ] Both halves of the pair show D for that week only; the following week
      reverts to the original partner.
- [ ] The same on a "no substitute" series is refused.

## 6. Admin on-behalf (Phase 6)

- [ ] Admin searches for Member E (who "phoned in") and signs them up with
      Member F for a session.
- [ ] Both cards match; `auditLog` records the admin as actor with a timestamp.
- [ ] Admin cancels an entry on behalf of a member — audit row written,
      partner notified.

## 7. Integrity (Phase 6)

- [ ] Manually corrupt one half of a pairing in the emulator console.
- [ ] Run `verifyPairingConsistency` — the discrepancy is reported and (when
      repair is enabled) fixed, with an `auditLog` entry.

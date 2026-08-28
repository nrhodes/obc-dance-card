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

Open the web app at `http://localhost:5173/signin` (see `web/README.md` for
starting the emulators + seed + dev server first).

**2a. Member B: sign in with an emailed code**

- [ ] On `/signin`, type `member.b@example.org` (or any seeded member's
      email) into "Email address".
- [ ] Click **"Email me a code"**. The screen changes to "We've emailed a
      6-digit code to member.b@example.org. It's valid for 10 minutes." —
      note the copy never says "click a link".
- [ ] Find the code: the functions emulator's stdout prints a
      "--- email (console provider) ---" block with the code in it, and it is
      also written to the Firestore Emulator UI
      (`http://127.0.0.1:4000/firestore`), collection `emulatorOutbox` — open
      the newest document and read the code out of its `text` field.
- [ ] Type the 6 digits into the code box (typing or pasting both work —
      the field accepts a pasted 6-digit string with spaces stripped).
- [ ] Click **"Sign in"**. You land on Home, greeted by first name.
- [ ] Click **"Send a new code"** immediately after a previous send — it is
      greyed out with a "(NNs)" countdown for 60 seconds, then becomes
      clickable again.
- [ ] Type an obviously wrong 6-digit code and click "Sign in" — you see
      "That code is not valid. Request a new one." (never a raw error).
- [ ] Click **"Use a different email"** from the code screen — you return to
      the email step with the two buttons.

**2b. Member A: set a password, then sign in with it**

- [ ] Sign in as Member A with the code path above, then go to **Profile**.
- [ ] Under "Set a password (optional)", enter a password with 8+ characters,
      at least one letter and one number, twice, and click **"Set
      password"**. You see "Password set."
      - If instead you see "For your security, please sign in again first",
        it's because your sign-in isn't recent enough for Firebase's
        recent-login check — complete the emailed-code step shown inline;
        the password is set automatically once you verify.
- [ ] Click **"Sign out"** (top nav). You return to `/signin`.
- [ ] Enter Member A's email, click **"I have a password"**, enter the
      password just set, click **"Sign in"**. You land on Home.
- [ ] Enter the wrong password and click "Sign in" — you see "That email and
      password don't match. You can sign in with an emailed code instead."
      Try an email that doesn't exist at all — you see the exact same
      message (no way to tell the two apart from the UI).
- [ ] Back in Profile, click **"Remove password"**, then confirm with **"Yes,
      remove my password"**. You see "Password removed... sign in with an
      emailed code next time." Sign out and confirm the password field no
      longer works for this account (only the code path does).

**2c. Deactivated / unknown accounts**

- [ ] Request a code for an email that isn't in the member list. The UI
      response is identical to a known member's ("We've emailed a 6-digit
      code to ...") — no account is created and no code is actually sent
      (verify via the Auth Emulator UI, `http://127.0.0.1:4000/auth`, that no
      new user appears).
- [ ] As the admin, deactivate a member (`deactivateMember` — Phase 6 UI;
      until then, flip `active: false` on their `members/{uid}` doc via the
      Firestore Emulator UI for this check). Sign in as that member (they may
      already be signed in on another tab) — they see "Your membership is
      not active — please contact the club." with only a Sign out button; no
      member data is shown.

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

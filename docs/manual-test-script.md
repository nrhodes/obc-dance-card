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
- [ ] Go to **Admin: Programme import** (`/admin/programme`). Download the
      three templates (weekdays/series/singles) from the links at the top.
- [ ] Paste or upload weekdays.csv, series.csv, singles.csv for a new year
      (the year field defaults to next year after 1 Oct NZ, this year
      otherwise — check it matches what you expect before continuing).
- [ ] Click **Check files (dry run)** — the report shows weekday/series/session
      counts and zero errors; **Import** stays disabled until this step has
      run against the exact text you're about to import.
- [ ] Click **Import** — the report now shows the same counts; the year
      appears in the **All programmes** list below with status `draft`.
- [ ] Try importing the same year again without ticking anything — you get
      the "already published" `failed-precondition` only if it was already
      published; for a fresh draft, re-importing just overwrites the draft.
- [ ] Click **Publish {year}** in the All programmes list, confirm the
      dialog ("Members will be notified") — status flips to `published` and
      a `publishedAt` timestamp appears.
- [ ] As a non-admin member, confirm `/admin/programme` is not reachable
      (redirects home) and that the programme only becomes visible at
      `/programme` once published — not before (rules deny reading a draft).
- [ ] Re-import the same year with `replace` unchecked over the now-published
      programme — you get the "already published" error with a **Replace
      existing programme** checkbox; tick it and re-import to confirm replace
      succeeds when no removed session has active sign-ups.

## 1a. Programme browsing (Phase 2b)

- [ ] As a member, open **Programme** in the nav (`/programme`). The default
      tab is today's weekday (Mon–Fri) or Monday on a weekend.
- [ ] Click through the Mon/Tue/Wed/Thu/Fri tabs with the keyboard (arrow
      keys move focus and selection) as well as the mouse.
- [ ] On Monday, confirm "Marion Taylor Pairs" appears as a card with a `Scr`
      and `Pairs` badge, and its four dates as links; a later "no substitute"
      series shows a "no substitutes" badge and its "best N of M" text.
- [ ] Confirm the Holiday Bridge dates (e.g. Easter Monday) appear inline
      between the series cards in date order, and Good Friday's "No bridge"
      entry (Friday tab) is visually greyed out.
- [ ] Click **Jump to today** — the view scrolls to the next upcoming
      session.
- [ ] Click a past date — it's dimmed but still opens its session page.
- [ ] Click a date under Marion Taylor Pairs — you land on
      `/session/2027/<id>` showing the title, weekday/date, start/seated-by
      times, and "Nobody has signed up yet." (no entries exist yet this
      phase).
- [ ] All the action buttons on the session page are visibly disabled with a
      "Coming soon" tooltip — confirm nothing is clickable/writes anything.
- [ ] On the Home screen, confirm "Next sessions" lists the next five
      upcoming sessions in date order, each linking to its session page.

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

## 3. My Card, invites, and session actions (Phase 3b)

**3a. My Dance Card (`/`) — empty state**

- [ ] Sign in as Member A (who has no entries yet). The home screen still
      greets you ("Hello, `<first name>`") and, below it, **My dance card**
      shows "Nothing on your card yet — open the Programme to sign up."
- [ ] Click **Show past** — it toggles to "Hide past" and shows "No past
      sessions yet." (or nothing, if there is genuinely no history).

**3b. Send an invite for a single session**

- [ ] Member A opens a future Monday "Marion Taylor Pairs" session
      (`/programme` → Mon tab → a date).
- [ ] Under **Actions**, click **Invite a partner**. A dialog opens
      (title "Invite a partner"); type part of Member B's name into
      **Search members**, confirming Member A's own name and anyone already
      confirmed on this session never appear in the list.
- [ ] Click Member B in the list — the dialog switches to "Invite `<Member
      B>`"; optionally type a short message; leave **Invite for the whole
      series** unticked; click **Send invite**. The dialog closes and a
      "Invite sent." banner appears.
- [ ] Press <kbd>Escape</kbd> to confirm a dialog can be dismissed this way
      (open **Invite a partner** again, then close it without sending).

**3c. Accept the invite**

- [ ] Sign in as Member B (a second browser/incognito window, or sign out
      and back in). The nav's **Invites** link shows a badge (**1**).
- [ ] Open **Invites** (`/invites`). Under **Incoming**, see Member A's name,
      "single session", the session's date, the message (if any), and the
      expiry. Click **Accept**.
- [ ] **Both** My Cards (`/`) now show the pairing for that session ("with
      `<partner's name>`"), grouped under the right weekday → series; the
      session's roster (`/session/...`) lists them as a confirmed pair. The
      **Invites** badge is gone for Member B; the invite now appears under
      **Recently resolved** for both.
- [ ] Member A opens the same session and confirms **Actions** now show
      **Cancel this session** (and a disabled **Arrange a substitute**), not
      the invite/looking-for-partner buttons.
- [ ] Member A tries to invite a third member (Member C) to the *same*
      session — the invite dialog no longer offers Member B (already
      confirmed), and if attempted via the API directly the call fails with
      `failed-precondition` shown verbatim.

**3d. Looking for a partner / Available, and claiming**

- [ ] Member C opens a different, still-open Monday session and clicks
      **I'm looking for a partner**. A dialog offers an optional short note;
      click **Confirm**. The session roster now lists Member C under
      "Looking for a partner"; Member C's own **Actions** area now shows
      **Switch to available** and **Remove**.
- [ ] Member D opens the same session and sees a **Play with `<Member C>`**
      button next to Member C's roster row; click it, confirm "You'll be
      paired with `<Member C>` for this session." in the dialog, click **Play
      with them**. Both are now confirmed; Member C gets a notification.
- [ ] On a fresh session, Member E clicks **I'm available** instead; Member F
      sees an **Invite `<Member E>`** button next to that row, which opens
      the invite dialog pre-filled with Member E.
- [ ] On an Individual-format series, pair the same two members again on a
      different session of that series (via claim or accept) — a non-blocking
      "You've already played with `<name>` in this individual series." notice
      appears; the pairing still succeeds.

## 4. Cancel and re-match, and notifications (Phase 3b)

- [ ] Member A (confirmed with Member B) opens the session and clicks
      **Cancel this session**. The confirm dialog explains the consequence
      in plain words first — "`<Member B>` will be told you've cancelled and
      will be shown as looking for a partner." — before any button is
      pressed. Confirm.
- [ ] Member A's entry disappears from their My Card (cancelled entries are
      not shown); Member B's roster row flips to "Looking for a partner",
      and their My Card line now reads "Looking for a partner" for that date.
- [ ] Member B opens **Notifications** (`/notifications`) — a new, boldly
      styled unread entry "Your partner cancelled" appears at the top. Click
      it: it is marked read (the styling changes and the nav badge count
      drops) and it follows the deep link back to the session page.
- [ ] Click **Mark all read** — every remaining unread item's styling
      updates and the nav badge disappears.
- [ ] Member C sees Member B "Looking for a partner" on that session's
      roster and claims them (§3d) — both cards match again.
- [ ] Withdraw an invite: Member A sends a fresh invite to Member G, then
      opens **Invites** → **Sent** and clicks **Withdraw** before Member G
      responds. Member G's **Invites** badge never appears for it, and it
      moves to **Recently resolved** ("cancelled") for both.
- [ ] Decline an invite: Member A invites Member H; Member H opens
      **Invites** and clicks **Decline**. Member A is notified
      ("Your invite was declined").

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

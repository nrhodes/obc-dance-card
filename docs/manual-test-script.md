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

## 5. Substitute (Phase 4c)

- [ ] Member A and Member B are a confirmed pair on a session in a series
      with substitutes allowed (e.g. "Marion Taylor Pairs"). Member B (the
      remaining player) opens the session and, under **Actions**, clicks
      **Arrange a substitute**.
- [ ] The dialog asks in plain words which side is covered — click
      **"`<Member A>` can't come — someone will play with me instead"**
      (`coverFor: 'partner'`).
- [ ] Search for and click **Member D** in the picker (self, the partner,
      and anyone already confirmed on this session do not appear in the
      list).
- [ ] Both Member A's and Member B's My Card lines for that session now read
      "with `<other>` — sub: Member D for `<covered>`" / "you're covered by
      Member D"; the roster row shows "`A` & `B` (sub: D for A)". Member D's
      own card shows a line for the same session with **Cancel this
      stand-in** as its only action.
- [ ] Member A (the covered player) opens the session; under **Actions**
      they see "Member D is standing in for you this week" and a **Remove
      substitute** button. Click it, confirm — the pairing reverts to A & B
      for that session and Member D's entry is cancelled.
- [ ] Re-arrange the same substitute, this time with Member A (the covered
      player) opening the dialog and choosing
      **"I can't come — someone will play with `<Member B>` instead"**
      (`coverFor: 'self'`) — same result.
- [ ] On a series with substitutes **not** allowed (e.g. one imported with
      `allowSubstitute=no`), a confirmed pair's Actions panel shows
      "This series does not allow substitutes." instead of the button.
- [ ] A pair where one side is a **visitor** shows no substitute option at
      all — instead, a line reads "To change a visitor partner, cancel and
      sign up again."

## 5b. Visitors (Phase 4c)

- [ ] Member A opens **Profile** → **Manage my visitors** (`/visitors`) →
      **Add a visitor**, enters a name only, and clicks **Add visitor**. The
      visitor appears in the list with no "now a member" badge.
- [ ] Add a second visitor whose name matches an existing active member's
      full name — a non-blocking warning banner appears ("An active member
      is also named... double check you meant to add a visitor").
- [ ] Edit a visitor (add an email and tick **Send them a confirmation
      email** — the checkbox is disabled until an email is entered), save.
- [ ] Open a Pairs or Individual session where Member A is free. Under
      **Actions**, click **Play with a visitor** → pick the visitor (or
      **Add a new visitor** inline) → for a series session, tick **For the
      whole series** to sign up every remaining date at once. The roster
      shows "`<Member A>` & `<visitor name>` (visitor)"; Member A's My Card
      line reads "with `<visitor name>` (visitor)".
- [ ] Try to delete a visitor with an upcoming, non-cancelled entry — the
      server's message ("This visitor has upcoming, non-cancelled entries —
      cancel those first.") is shown verbatim in the confirm dialog; deleting
      a visitor with no future entries succeeds.

## 5c. Teams (Phase 4c)

- [ ] Member A opens the seeded **Campbell Cave Teams** session (Monday,
      first date 2027-09-20) and clicks **Start a team**, leaving the name
      blank. The Team panel shows "`<A's surname>` team", "Forming (1 of
      4–6)", and Member A listed as captain.
- [ ] Captain clicks **Invite a member**, searches for and selects Member B,
      and sends the invite. Member B's **Invites** badge shows the new
      count; opening **Invites** shows "Team invite from `<A>` — `<team
      name>` (Campbell Cave Teams)" with Accept/Decline.
- [ ] Member B clicks **Accept**. Both A and B now see the team with 2
      members on the session page; once a fourth member joins, the status
      flips to "Active (4 of 4–6)".
- [ ] Captain clicks **Add a visitor**, picks (or adds) a visitor — it
      appears in the roster marked "(visitor)", with no card entry of its
      own.
- [ ] Member B cancels their own entry for one session only (as in §4) — the
      Team panel's "This session" area now lists them under **Absent**, and
      the captain sees **Add a substitute for this session** become
      enabled; adding one (a member or a visitor) shows "Standing in:
      `<name>`" for that session only, with a **Remove** link for the
      captain.
- [ ] Captain clicks **Transfer captaincy**, picks Member B, sends the
      offer. Member B sees "`<A>` wants you to be captain of `<team
      name>`" in Invites and accepts — the team panel now shows B as
      captain.
- [ ] (New) Captain clicks **Leave team** — the panel instead explains
      "Transfer the captaincy or disband first." A plain member's **Leave
      team** works immediately (confirm dialog), cancelling their future
      entries in the series.
- [ ] On the same Teams session, a member not on any team clicks **I'm
      looking for a team**; a captain with space sees **Add `<name>` to my
      team** on that noticeboard row and claims them straight onto the
      roster. A member who clicks **I'm available for a team** instead is
      sent a team invite via **Invite `<name>`**.
- [ ] Captain clicks **Disband team** and confirms — every member's future
      entries in the series are cancelled and all members are notified
      ("Your team has been disbanded").

## 6. Admin web UI: members, on-behalf, programme editing, broadcast, audit log (Phase 6b)

### 6.1 Members

- [ ] Sign in as the admin. Click **Admin: Members** in the nav. The **Members**
      tab is selected by default; click **Import CSV** and confirm the existing
      members-import screen still works unchanged, then click back to **Members**.
- [ ] Type a member's first name into **Search by name** — the table narrows to
      matches. Clear it. Set **Status** to "Inactive" — the table shows only
      deactivated members (none, on a fresh seed). Set it back to "All". Set
      **Role** to "Admins only" — only the seeded admin row remains. Set it back
      to "All".
- [ ] On an ordinary member's row, click **Make admin**, confirm in the dialog —
      the row's Role column now reads "admin"; click **Remove admin** on the
      *same* row (now the only non-seed admin) to reverse it.
- [ ] With only the seeded admin remaining an admin, click **Remove admin** on
      *that* row and confirm — the dialog shows the server's last-admin error
      ("You cannot demote the only active admin.") verbatim, and the role is
      unchanged.
- [ ] On Member E's row, click **Deactivate**. The dialog explains the cascade
      (future pairings cancelled, partners notified, invites expired, teams
      updated) before you confirm; optionally type a reason. Confirm — the row's
      Active column flips to "No", and the row now offers **Reactivate** and
      **Erase** instead of **Deactivate**.
- [ ] Click **Erase** on Member E's row immediately after deactivating — the
      dialog explains the 30-day rule and shows the server's verbatim refusal
      when you try anyway (it has not been 30 days). Type the member's full name
      into the confirmation field exactly, then a *wrong* name — the **Erase
      permanently** button stays disabled until the typed text matches exactly.
- [ ] Click **Reactivate** on Member E's row and confirm — Active flips back to
      "Yes" and the row's actions return to **Deactivate**.

### 6.2 Act on behalf (Phase 6b task deliverable 2)

- [ ] On Member F's row, click **Act on behalf**. A banner appears above the
      page content: "Acting on behalf of `<Member F>` — Stop".
- [ ] Click **Programme** in the nav, open a Pairs session, and click **I'm
      looking for a partner** → **Confirm**. The roster's "Looking for a
      partner" list shows *Member F*, not the admin — confirming the action was
      performed as the acted-on member.
- [ ] Click **My card** in the nav — it shows Member F's card ("Showing
      `<name>`'s dance card."), not the admin's own.
- [ ] Click **Stop** in the banner — it disappears, and **My card** now shows
      the admin's own (empty) card again.
- [ ] Repeat the act-on-behalf flow, this time sending an invite (**Invite a
      partner**) and signing up with a visitor (**Play with a visitor**) as
      Member F — both dialogs work exactly as they do for the signed-in member,
      and the resulting invite/entry belongs to Member F.

### 6.3 Programme editing

- [ ] Click **Admin: Programme**. Scroll to **Edit series & sessions**, pick the
      published year, and expand a series with no sign-ups. Click **Edit
      series**, change the name, and save — the change appears in the expanded
      session list's title column.
- [ ] On a series with a non-cancelled entry (e.g. after 6.2's sign-up), try
      changing that series' **Format** and saving — the server's verbatim
      refusal ("Cannot change this series' format while it has non-cancelled
      entries…") is shown.
- [ ] Click **Edit** on a session with a non-cancelled sign-up — the dialog
      shows the sign-up count and, on trying to change its date, shows the
      verbatim "Cancel entries first…" refusal.
- [ ] Click **Edit** on a session with no sign-ups, then **Remove session** —
      the confirm dialog explains the cascade; confirming removes it from the
      list.

### 6.4 Broadcast

- [ ] Click **Admin: Broadcast**. Type a title and body. With no weekday
      checked, the preview reads "This will notify `<N>` members (all active
      members)." Check one weekday — the count narrows to active members with a
      future session that day.
- [ ] Click **Preview & send**, confirm in the dialog — the screen shows "Sent
      to `<N>` members." Sign in as one of the recipients in a second browser
      (or context) and confirm their **Notifications** feed shows the broadcast.

### 6.5 Audit log

- [ ] Click **Admin: Audit log**. With no filter, the most recent 50 entries
      show (including the role changes, deactivate/reactivate, and on-behalf
      rows from 6.1–6.2). Click **Load more** if there are more than 50.
- [ ] Set **Filter by** to "Action", pick `set_solo_status_on_behalf` — only
      that action's rows remain, with the admin as actor and Member F as
      target. Click **Details** on one — a `<pre>` block shows the raw
      `entityRef` context as plain text (never rendered as HTML).
- [ ] Set **Filter by** to "Actor" or "Target member" and confirm each narrows
      the list to that member's rows.

## 7. Integrity (Phase 6b)

- [ ] Click **Admin: Integrity**. Click **Run check** — with a freshly seeded
      or otherwise healthy emulator, it reports 0 violations and "No violations
      found."
- [ ] Manually corrupt one half of a pairing in the Firestore emulator UI (e.g.
      clear one side's `partner` field while the other still points at it).
      Click **Run check** again — the violation is listed (kind, id, issues)
      but nothing is fixed.
- [ ] Click **Run check and repair**, read the confirm dialog's explanation of
      what repair does, and confirm — the corrupted entry is reverted to
      "looking for a partner", the "Repaired" count is non-zero, and the
      **Run check and repair** result offers a link to the audit log
      pre-filtered to `pairing_repair`; following it shows the repair's
      before/after in a `<pre>` block.
- [ ] Run `verifyPairingConsistency` (the scheduled job) directly and confirm
      it produces the same kind of `auditLog` entry when `PAIRING_SWEEP_REPAIR`
      is enabled.

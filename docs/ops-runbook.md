# Ops runbook

## Environments

| Env | Firebase project | Notes |
|---|---|---|
| local | `demo-obc` | Emulator only. No real project; `demo-*` disables all cloud calls. |
| dev | `obc-dance-card-dev` | Optional shared sandbox. |
| prod | `obc-dance-card` | Blaze plan. Billing budget alert set at NZ$5. |

Copy `firebase/.firebaserc.example` to `firebase/.firebaserc` and fill in the real
project ids. Copy `firebase/functions/.env.example` to `.env` for local runs.

## First-time setup (prod)

1. Create the Firebase project; upgrade to **Blaze**; set a **budget alert**.
2. Enable **Authentication** → Email/Password provider.
3. Enable **Identity Platform** (required for the sign-in blocking function).
4. `firebase deploy --only firestore:rules,firestore:indexes,functions`
5. Configure email: set `EMAIL_PROVIDER` + credentials as Firebase Secrets
   (`firebase functions:secrets:set ...`). For the zero-cost option, install the
   **Trigger Email from Firestore** extension pointed at the club's Google
   Workspace SMTP.
6. Import members (`importMembers` callable via the admin UI) — this also
   provisions the first admin: set one member's `role` to `admin` directly in the
   console, then manage the rest in-app.
7. Import the programme CSVs (`importProgramme`), review, `publishProgramme`.

## Local development

```sh
npm install
npm run build -w @obc/shared          # once, and after changing shared types
npm run emulators                      # Firestore + Auth + Functions + UI
npm run seed -w @obc/functions         # sample data
npm run dev -w web
```

Java 11+ must be on PATH for the emulator suite (`mise use -g java@temurin-21`
or the distro package).

## Cost watch

- Firebase itself should stay at $0 at club scale; the budget alert is the
  backstop.
- `maxInstances` for functions is pinned low in `src/index.ts`.
- The only recurring cost is transactional email if it exceeds the provider free
  tier; the Workspace-SMTP route avoids it.

## Common tasks

- **Add/adjust an admin:** `setMemberRole` callable (admin-only) or the console.
- **A member changed email:** update the row and re-run `importMembers`; the old
  address stops working, the new one starts. Their card is keyed on uid, so it
  survives if the uid is unchanged — for an email change, the member re-links on
  next login. (Detailed procedure TBD in Phase 1.)
- **Suspected split pairing:** run `verifyPairingConsistency` (Phase 6) — it
  reports and optionally repairs one-sided entries and writes to `auditLog`.

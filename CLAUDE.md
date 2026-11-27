# OBC Dance Card — working notes for agents

**Read first:** `docs/implementation-plan.md`. It is the contract: settled decisions (§2),
implementer rules (§3), data model (§5), invariants (§7), security design (§8), the full
callable API (§9), rules spec (§10), visitors (§12), teams (§12A), phases + definition of
done (§16), verification (§17). Only §20 (open items) and §21 (backlog of unscheduled
enhancements) are open. Do not re-litigate anything else.

## Commands

```sh
npm ci                                  # deps (workspaces: shared, web, firebase/functions)
npm run build && npm run typecheck && npm run lint && npm test   # must be green before a phase is done
npm run test:rules -w @obc/functions    # Firestore rules tests (needs Java; emulator, project demo-obc)
npm run emulators                       # Firestore+Auth+Functions+UI on localhost (demo-obc)
```

## Non-negotiables

- Clients never write Firestore except `notifications/{id}.read/readAt`. All mutations are callables.
- `shared/` is the single source of truth for types, enums, zod schemas, callable contracts.
- Club-owned data (members, programme, entries, invites, teams, visitors, audit log) is addressed only through `clubPaths(clubId)` (`shared/src/paths.ts`); person-level data through `paths`. Server handlers get the club from `clubOf(input)`, web from `useClub()`, iOS from `Club.current`. Never spell a collection name inline (plan §21 B14). Any code that creates a membership or changes its `active` flag must also write `users/{uid}.clubIds` (`userClubsWrite`) — the rules read it.
- Every pairing/team mutation runs in a transaction and must satisfy `validatePairingGroup` / `validateTeamGroup` (plan §7) before commit.
- Never log codes, tokens, emails, phones. Never commit secrets (`.env`, service accounts are gitignored). `GoogleService-Info.plist` is public Firebase config, committed like `web/.env.production`.
- Tests and seeds talk only to the emulator (`demo-*` project ids).
- Date logic uses `Pacific/Auckland` via `shared/src/time.ts`.

## Layout

`shared/` types + templates · `firebase/` rules, indexes, `functions/` (gen2, Node 22), `seed/` · `web/` React PWA · `ios/` SwiftUI · `docs/`

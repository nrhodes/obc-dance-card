# Emulator seed data

`npm run seed` (from `firebase/functions`) loads a representative data set into the
running emulator so the apps have something to render during development:

- ~20 fake members (a mix of grades; one admin) with `@example.org` addresses
- the 2027 Monday and Tuesday programme transcribed from the club booklet photos
- a handful of pre-made pairings, one open "Looking for Partner" entry, and one
  pending invite

The script talks to the Auth + Firestore emulators only and refuses to run against
a project id that is not `demo-*`, so it can never touch production data.

Implemented in Phase 1 (`seed/seed.ts`) once the member and programme writers exist.

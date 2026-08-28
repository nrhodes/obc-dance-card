# Testing conventions

## Unit tests (`src/**/*.test.ts`, `npm test`)

Pure logic only — no emulator, no network. Run by the default `vitest.config.ts`.

## Emulator tests (`src/**/*.emu.test.ts`, `npm run test:emu`)

Run against the Firestore + Auth emulators via:

```sh
npm run test:emu -w @obc/functions
```

which is `firebase --project demo-obc emulators:exec --only firestore,auth "vitest run --config vitest.emu.config.ts"`.
`emulators:exec` sets `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST` for the
child process automatically; the Admin SDK singleton in `src/lib/admin.ts` picks these up
with no extra wiring.

### Invoking callables in tests

Every callable module in this codebase exports **two** things:

- `xxxHandler` — the plain `async (req: CallableRequest<Input>) => Result` function,
  with no `onCall(...)` wrapper.
- `xxx` — the deployed function, `onCall(options, xxxHandler)`.

Tests import and call `xxxHandler` directly with a hand-built fake `CallableRequest`:

```ts
const result = await requestLoginCodeHandler({
  data: { email: 'member@example.org' },
  auth: undefined,
  rawRequest: { headers: {}, ip: '203.0.113.1' } as never,
} as CallableRequest<RequestLoginCodeInput>);
```

This avoids depending on `firebase-functions-test`'s wrapping/mocking behaviour (which
still works and is a valid alternative — see its docs — but isn't used here) and keeps
secrets simple: bind a callable's secrets by setting the matching environment variable
directly before importing the module under test, e.g.

```ts
process.env.LOGIN_CODE_PEPPER = 'test-pepper';
```

`defineSecret(...).value()` reads `process.env[NAME]` when not running inside an actual
deployed function, so this is sufficient — do this **before** any `import` of a module
that calls `.value()` at request time (module-level top-level code never calls `.value()`
in this codebase; it's always read lazily inside a handler, so ordering relative to the
`import` statements themselves doesn't matter, only relative to when the handler runs).

Blocking-function handlers (`beforeUserCreatedHandler`, `beforeSignInHandler` in
`src/auth/blocking.ts`) are exported the same way and are called with a fake
`AuthBlockingEvent` (`{ data: { uid } }`).

### Direct Firestore/Auth access for setup and assertions

Import `db` and `auth` from `src/lib/admin.ts` directly to seed documents, create Auth
users, or assert on emulator state — same singleton the handlers use, so everything is
consistent within one test run.

### Signing in as a real client

A few tests need to prove a minted custom token actually works end-to-end. These use the
`firebase` (client) SDK's `initializeApp` + `connectAuthEmulator` + `signInWithCustomToken`,
pointed at `process.env.FIREBASE_AUTH_EMULATOR_HOST`.

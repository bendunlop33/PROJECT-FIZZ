# 0002: Domain core structure: schemas, pure reducer, storage ports

**Status:** Proposed, 2026-10-08 (developer; for review)

## Context
Build step 1 needs the logging core before the Expo app exists, and how the app gets onto Ben's iPhone is still being decided. The core has to be testable on Linux, must not depend on React Native, and has to satisfy the CLAUDE.md rules on idempotent, versioned writes, achievable loads and never silently changing completed sets.

## Decision
- **npm workspaces, two packages for now.** `packages/schemas` holds zod 4 schemas and inferred types for entities and the session command union. `packages/domain` holds pure rules and the session state machine. Packages export TypeScript source (`main: src/index.ts`) with extensionless imports, so Metro can bundle them later without a build step. TypeScript 6.0.3 matches the Expo SDK 57 template. All versions are pinned exactly.
- **Runtime validation at boundaries only.** Persisted rows, imports and coach/voice tool arguments go through `validate(schema, input)`. Inside the domain, functions trust their typed inputs.
- **Session = one aggregate, one pure reducer.** `reduceSession(state, command)` is the only way an active session changes. UI taps, voice turns and coach tools all produce the same typed commands. The aggregate (session, exercises, sets, rest timer, work interval, audit, processed operations) is saved as one unit, which matches "set result plus rest timer in one transaction".
- **Two counters on the session:**
  - `session.version`: the content version. It bumps on log, correction, undo, active-set change and finish. Proposals and `expectedVersion` checks bind to it, so a +30 s tap or a pause doesn't make a coach proposal stale.
  - `revision`: the storage revision. It bumps on every persisted change and is used for optimistic concurrency in the repository.
- **Idempotency is in the aggregate.** `processedOps` records each operation ID with a fingerprint of its intent (generated IDs and timestamps are excluded). A repeat is a no-op `duplicate`; a different command reusing an ID is rejected. The per-set log operation ID is derived (`log:<setId>:<undoCount>`), so it survives a force-close without extra storage.
- **Time is an argument.** Commands carry `at` (UTC plus IANA zone). Timers store deadlines. Lint forbids the `Date` global in source outside `time.ts`.
- **Storage ports, no SQLite yet.** `ports.ts` defines async repositories. `memory.ts` is a test-only implementation. The `expo-sqlite` adapter will implement the same ports with `withExclusiveTransactionAsync` and a single write queue (research §2.1).

## Consequences
- The whole logging loop, including restart recovery, is testable with `npm test` on Linux. Real-device behaviour (SQLite durability on kill, notifications, audio) still needs the device spike.
- Persisting the aggregate as one unit is simple and atomic. The SQLite adapter can still normalise it into tables inside one transaction. `processedOps` and `audit` grow per session, which is fine for single-user session sizes.
- zod is a runtime dependency of the app bundle (size not yet measured). Check it, and Hermes compatibility, when the Expo app is created.
- **Open:** whether the SQLite adapter stores the aggregate as JSON plus indexed columns, or as fully normalised tables. Decide in the persistence slice.

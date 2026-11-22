# Review: fix-backup (backup bugs B1, B2)

Branch `claude/fix-backup` vs `claude/gracious-knuth-joxqpw` (commits b497875, 6b1b3cd).
Reviewer: independent reviewer agent, 11 Oct 2026.

## Verdict: PASS

Both bugs are fixed at the root, and each has a test that fails without the fix. Nothing
breaks rules 1-10, and the branch adds no UI copy. The should-fix items below are follow-ups,
not blockers.

## Checks run

- `npm run typecheck`: pass
- `npm run lint`: pass
- `npx vitest run --testTimeout=120000`: 179 files, 3638 passed, 1 todo
- **Tests fail without the fix.** I temporarily checked out the base branch's
  `apps/mobile/src` and `packages/persistence/src`, ran the new mobile tests, then restored
  them and confirmed the tree was clean. Five tests failed:
  - `backup-perf`: longest block 6,966 ms against a limit of 1,000 ms
  - both B2 scenarios: `'backed_up'`, expected `'pending'`
  - the legacy-record test
  - the idle-wait test

  The persistence perf test can't build against the base, because `timeSlicer` doesn't exist
  there. It measures the same blocking.

## Bug-by-bug

### B1: backups and restore checks freeze the JS thread

**Fixed at the root.**

- `Sha256Stream` (packages/persistence/src/backup/sha256.ts) encodes UTF-8 straight into a
  64-byte block. The 15M-entry `number[]` is gone.
- `createBackup` (backup.ts:138-189) serialises once with `writeStable`. One pass produces
  both the body checksum and the whole-file SHA-256, using a cloned prefix state.
- The read-back is compared as text, so there's no second hash (backup-service.ts:198, 312).
- Rotation checks the length first, then hashes in slices (backup-service.ts:241).
- `DatabaseManager.verify` parses and hashes each backup text once across Check, preview and
  Restore (manager.ts:961).
- Every long loop calls a time-based `Slicer` with an 8 ms budget, and background runs wait
  for `whenIdle` before starting.
- Hash correctness is tested against `node:crypto`, including lone surrogates and every
  possible split point. `writeStable` is tested to match `stableStringify` byte for byte.
- The backup format is unchanged. Parsing ignores key order, and the checksum is still
  `stableStringify(body)`, so older files still verify.

### B2: "Backed up" after Undo import or restore

**Fixed for the bug as reported.**

- Coverage is now decided by a digest of the sorted IDs of finished workouts
  (`finishedWorkoutsDigest`), stored on each `BackupRecord` and compared in both
  `onPhoneState` and `ensureBackedUp`.
- Legacy records fall back to the count comparison.
- Tests cover Undo import followed by an interrupted Finish, restoring a smaller backup
  followed by an interrupted Finish, and the legacy fallback.

## Blocking

None.

## Should fix

**S1. Coverage still ignores corrections to finished workouts. Same honesty gap, different trigger.**
`packages/persistence/src/backup/coverage.ts:9`, `store.ts:118`, `backup.ts:181`.

- **What's wrong:** the digest covers which workouts exist, not their content.
  `correct_set`, `update_session_timing` and `rename_session` are all accepted on a finished
  session (reducer.ts:1600).
- **Scenario:** Ben finishes a workout and the backup runs. That evening he corrects a set
  from 100 kg to 110 kg in History. Data & backup still says "Backed up on this phone ·
  18:00", and the launch catch-up never runs, but the newest file holds 100 kg.
- This was already true before the branch. The fix hint offered a version or revision
  watermark that would have covered it at the same cost.
- **Fix:** hash `id:version` (or `id:revision`) of finished sessions instead of the bare ID,
  both in `createBackup` (from `tables.sessions`) and in `store.finishedWorkoutsDigest()`.
  Add a test: back up, correct a set, then expect `pending` and a catch-up.

**S2. The B2 Undo-import test simulates the undo instead of running it.**
`apps/mobile/test/backup-service.test.ts:225`.

- **What's wrong:** the test runs `UPDATE sessions SET status = 'discarded'`. The real path
  is `imports.revertJob`, which sets `'reverted'`, and the workouts don't come from an import
  job.
- **Risk:** if `revertJob` or `countRecords` changes, this test won't notice.
- **Fix:** drive a real import commit and `revert()` through the import service, or call
  `revertJob`, as the bug repro did.

**S3. The export still holds the store queue for its whole (now longer) sliced duration.**
`packages/persistence/src/backup/backup.ts:48-69, 140`.

- **What's wrong:** `exportTables` yields macrotasks inside one `db.read` slot. The screen
  stays responsive, but any write queued meanwhile waits for the whole export, which is now
  longer because of the pauses. That includes Summary Undo, coach-target Undo, or a set
  logged in a new workout.
- **Scenario:** on Hermes with a 3-year history, Undo on Summary right after Finish may take
  a second or more to apply.
- This is better than before, since the integrity check moved out of the slot, but it isn't
  tested or measured.
- **Fix, either of:**
  - export in one transaction-consistent snapshot without the queue, using a dedicated
    read-only connection or `BEGIN` on a second driver;
  - or add a test asserting that a write issued during a backup completes within a bound.

**S4. No Hermes-like measurement.** `apps/mobile/test/backup-perf.test.ts`,
`packages/persistence/test/backup-perf.test.ts`.

- **What's wrong:** both perf tests run with V8's JIT on. Slicing bounds the hashing and
  serialising loops, but some steps aren't sliced: `JSON.parse(text)` in `parseBackup`,
  `pieces.join('')`, and `stableStringify` per row.
- **Why it matters:** on Hermes, `JSON.parse` of a 15 MB file may block for about a second
  during Check.
- **Fix:** run the perf tests once under `--jitless`, or note an on-device measurement in the
  real-iPhone checklist.

## Nits

**N1. The integrity report is no longer from the same snapshot as the exported rows.**
`backup.ts:140-142`.

- **What's wrong:** `checkIntegrity` now runs in later queue turns, so a record written
  between the export and the check is judged but isn't in the file.
- **Impact:** harmless in practice, but the `integrityOk` stored on the record can describe
  different data.
- **Fix:** worth a one-line comment.

**N2. The verified-backup cache holds the full backup until the next restore or close.**
`manager.ts:889`.

- **What's wrong:** after a Check, the 15 MB text and its parsed tables stay in memory.
- **Fix:** clear the cache when the restore screen unmounts, or after a time limit, to ease
  memory pressure on older iPhones.

**N3. After Undo import or a restore, nothing backs up until the next launch or the next Finish.**

- **What happens:** the status correctly drops to "Saved on this phone" (`pending`), so it's
  honest.
- **Fix:** an `after_undo_import` or post-restore backup reason, as the fix hint suggested,
  would bring the file back in step straight away.

**N4. `whenIdle` waits for idle inside the queue, so callers can wait longer than expected.**
`apps/mobile/src/device/runtime.ts:72`.

- **What happens:** `whenIdle` waits up to 1 s. `before_import` awaits the backup, so an
  import preview can take up to 1 s longer.
- **Fix:** none needed, but consider skipping `idle` for user-initiated runs.

## Rules check

| Rule | Status |
|---|---|
| 1, logging and AI honesty | Logging is never blocked by the UI thread; see S3 for queue waits. Status stays honest, apart from S1, which predates this branch. |
| 2, 3, 4, 9 | Not touched. |
| 5, idempotent and versioned writes | Restore still checks `expectedStamp`, and the parse cache is keyed on the exact text. |
| 6, no invented data | Nothing invented. |
| 7, credentials | No secrets added. |
| 8, imports are data | Backup rows are still schema-validated, now row by row. |
| 10, data separation | Unchanged. |
| Minimal copy | No new UI strings. |

## Spec issues

None found.

VERDICT: PASS

# Review: merging main (fix-backup, fix-setup, fix-workout, fix-coach) into claude/your-data

Reviewer: independent reviewer agent, 11 Oct 2026.
Scope: `claude/gracious-knuth-joxqpw..claude/your-data` at `23d263e`, which is what merging into main adds. Focus: merge
commit `d6411c7` (its `--cc` resolutions) and the follow-up tests in `23d263e`. Checked against CLAUDE.md rules 5, 7 and
10, `docs/design/data-import-export.md` §3.2, §3.6 and §4.5 (checks 30, 31 and 31a), ADR 0023, and main's fix-backup
review rules: B1 (no JS-thread freeze), B2 and S1 (finished-workout coverage digest) and N4 (background runs wait for
idle, user-started runs don't).

PASS means the merge has no blocking defect. Main's backup fixes survived intact, and Delete, Reset and Export still meet
rules 5, 7 and 10. The new Your-data paths don't yet follow B1's slicing everywhere (S1), and nothing measures them on a
real-sized history (S2). ADR 0023 still waits on Ben's eight answers, as review r6 S2 records. That is unchanged by this
merge.

## Checks run

- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npx vitest run --testTimeout=120000`: exit 0. 191 files, 3796 passed, 1 todo.
- **Measurement probe (not committed).** I wrote a throwaway test, ran it and deleted it. It loaded main's `largeHistory()`
  (2 years, 416 finished workouts, the B1 fixture) into a `DatabaseManager` on real SQLite files, then timed each step
  with `measureBlocking`. Results below are total time / longest single block.

  | Step | JIT | `--jitless` |
  |---|---|---|
  | `domainSummary()` (Export, Delete and Reset screens) | 711 ms / 17 ms | 9627 ms / 22 ms |
  | Export `your_data`: `exportDomain` + `JSON.stringify` (24.9 MB) | 439 ms / **439 ms** | 456 ms / **456 ms** |
  | `knowledgeExercisesInUse` alone (sync) | 153 ms | 262 ms |
  | `resetKnowledge` (unchanged result) | 12.6 s / **313 ms** | 31.5 s / 292 ms |
  | `deleteYourData` | 306 ms / 42 ms | 282 ms / 44 ms |

  For comparison, main's automatic backup on the same fixture blocks for about 150 ms at most (about 190 ms under
  `--jitless`).

## Merge-specific verification

- **Backup B1 (no JS-thread freeze) survived.** `createBackup`, `parseBackup`, `checkBackupShape`, `insertBackupRows`,
  `exportTables` and `sha256HexAsync` are unchanged from main apart from widening two parameter types to `Pick<…>`
  (`packages/persistence/src/backup/backup.ts:319,350`). `backUpNow` still creates backups with `slice` and compares the
  read-back byte for byte (`apps/mobile/src/backup/backup-service.ts:207-212`). The manager's `build()` inserts with the
  slicer. `keptOnly` was made async and sliced to follow main's async `fingerprints`
  (`packages/persistence/src/backup/replace.ts:56-68`). Every `contentHash` in Delete, Reset and `domainSummary` is
  awaited and sliced, and `readCurrent` and `readFile` page through the manager's slicer.
- **Coverage digest (B2/S1) survived.** `backupCovers` and `newest` are main's, now filtered by `backsUpThisPhone`, so a
  `kept_for_undo` backup (of another, older database) never stands for this phone
  (`apps/mobile/src/backup/status.ts:63-69`). `planRotation` also excludes it from the "newest restorable" that rotation
  protects (`manifest.ts:143`). Both are tested (`backup-service.test.ts` "Your-data backup kinds…", and
  `your-data.test.ts` "Restore → Reset with the UI never idle").
- **Idle deferral (N4) survived.** `Root.tsx` still passes `idle: () => whenIdle()`, and `whenIdle` is still bounded at 1 s.
  `before_reset`, `kept_for_undo` and `after_delete` are added to `USER_STARTED`, so they never wait for idle. `wipeOnPhone`
  calls `backUpNow` directly. Tested with an idle gate that never opens. Background `catch_up` still waits.
- **Rule 7 (Keychain wipe can't be blocked).** `coach_sign_in` is the first step after the swap
  (`data-domain-service.ts:93`). The wipe runs in `finally` even when the sign-out throws or times out (`:449-452`), and
  every later step runs even if one fails. The only waits before it are `backups.whenIdle()` (the backup chain, whose
  idle waits are bounded at 1 s) and the swap itself. If the swap fails and the data can't be checked, the marker stays
  and the next launch, or `Finish deleting`, runs the wipe. This is unchanged from r6. The merge adds nothing ahead of
  the wipe.
- **Rule 10.** Delete builds from `filterDomain(…, 'coaching_knowledge')` only (`manager.ts:614`). Reset builds from every
  Your-data row unchanged, plus the knowledge exercises in use and the bundled list (`manager.ts:648-653`). The table
  classification test still matches `sqlite_master` with main's `pre_start_drafts` included. `deleteYourData` now also
  drops the manager's cached checked backup (`this.verified = null`, `manager.ts:610`), and this is tested.
- **Rule 5.** Delete and Reset are confirmed against the same stamp as main's restore preview. Reset re-checks it inside
  the manager after its two backups. Op IDs are idempotent through the ledger.
- **Formats and migrations.** No training-schema migration was added. Main is at migration 7 (`pre_start_drafts`), which
  Your data classifies. Meta migration 3 (`database_slots` rebuilt to widen `switch_reason`) doesn't collide with main,
  which has meta migrations 1 and 2 only. It is tested from a version-2 meta database. The backup file format is
  unchanged. Only the manifest's `reason` enum grows (`before_reset`, `after_delete`, `kept_for_undo`). The export
  format (`fizz-export`, formatVersion 1) is separate and not restorable.

## Blocking

None.

## Should fix

**S1. Export, and Reset or Undo last reset, still run unsliced passes over the whole history on the JS thread (main's
B1 rule).**
- `packages/persistence/src/data-domains.ts:152`: `exportDomain` calls `exportTables(q)` with no slicer, then parses
  every JSON column in one loop.
- `apps/mobile/src/backup/data-domain-service.ts:504,516`: all of this runs inside `store.db.read`, which holds the
  store queue, and the file is then built with a single `JSON.stringify(file, null, 1)`.
- `packages/persistence/src/manager.ts:499-503,648-649`: `knowledgeExercisesInUse` (`data-domains.ts:201`) walks every
  string in every Your-data row and `JSON.parse`s each one that looks like JSON, synchronously. `filterDomain` and
  `countDomains` are also sync, but they are cheap (under 10 ms).

Failure scenario: Ben has two years of history (the B1 fixture) and taps Export → My data. The JS thread freezes for
about 440 ms in V8 (one block, 24.9 MB string). Main measured Hermes as several times slower than JIT V8 for this kind
of work, so the phone could freeze for 1–2 s. Any write issued meanwhile, such as a coach reply landing or a Summary
Undo, waits behind the read. Reset and Undo last reset block for about 300 ms (JIT) in one go. Both are the freeze that
main's backup review B1 fixed for backups.

Suggested fix:
- Page `exportTables(q, slice)` in `exportDomain`, and let the export leave the store queue before it parses the JSON
  columns, as `createBackup` does.
- Serialise with main's sliced stable stringifier, or stringify table by table with `await slice()` between tables.
- Make `knowledgeExercisesInUse` async and call `slice()` per row.
- Add an Export case to the perf test (S2).

**S2. No test measures Delete, Reset, Undo last reset, `domainSummary` or Export on a real-sized history.**
`packages/persistence/test/data-domains.test.ts` ("Delete and Reset with main's backup rules") only asserts
`pauses > 0` on the small `populate()` fixture. This proves the slicer is called somewhere, but not that every long loop
calls it. S1 got through for exactly this reason. Suggested fix: extend `packages/persistence/test/backup-perf.test.ts`,
or add a sibling, to run `domainSummary`, `resetKnowledge` (switched, not unchanged), `rollback` after a reset,
`deleteYourData` and `exportDomain` plus serialisation on `largeHistory()`. Assert `maxBlockMs < 1000` as the B1 tests
do, and add them to `npm run test:perf:jitless`.

**S3. Every visit to the Export screen hashes the whole database and opens the copy kept for Undo.**
`apps/mobile/src/screens/data/ExportScreen.tsx:24` calls `data.summary()`. That runs `domainSummary()`, which holds the
manager lock and computes the full content stamp. It also reads and fingerprints the rollback file through
`lostWithKeptCopy` (`manager.ts:529-537`). Export only needs the counts. On the B1 fixture this took 0.7 s (JIT) and
9.6 s (`--jitless`) of sliced work. While it runs, Restore, Undo and Delete queue behind the manager lock, and the screen
waits on it. Suggested fix: add a counts-only `data.counts()` for Export (no stamp, no kept-copy read). Keep the full
summary for the Delete and Reset confirmations, which need the stamp.

## Nits

**N1. The export read-back mismatch path isn't tested.** The merge changed `saveExportTo` from a hash compare to a text
compare (`data-domain-service.ts:708-710`), but no test hands it a destination that reads back different text. Backups
have that test. Add one with a `dest.read` that returns altered text, and expect `reason: 'failed'`.

**N2. A failed `kept_for_undo` backup reads as "Last backup on this phone didn't save".** `backUpNow` records that
failure as the phone's `lastAttempt` (`backup-service.ts:229-231`). `onPhoneState` then reports `failed`
(`status.ts:89-90`), even though the phone's own newest backup still covers it. This is mildly misleading. The Reset
screen already shows the real reason. Consider not recording `lastAttempt` for `kept_for_undo`, or recording it
separately.

**N3. Reset's total time on a long history is high.** `resetKnowledge` took 12.6 s (JIT) and 31.5 s (`--jitless`) of
sliced work on the B1 fixture, even when the result was `unchanged`. It builds and integrity-checks a full copy before it
compares hashes. The UI stays responsive, but the modal cover sits there that long, and ADR 0023's "Time on the phone is
to be measured" still applies. A cheap pre-check (is the knowledge part already identical to bundled plus in-use?) could
skip the build in the common no-op case. Not merge-specific.

**N4. Tie order in the copies list.** `kept_for_undo` and `before_reset` are written within the same second. The
`copiesOnPhone` sort comparator (`status.ts:153`) never returns 0, so equal `createdAtUtc` values sort unstably.
Cosmetic only.

## Spec issues

None new from this merge. The eight ADR 0023 questions for Ben (CHANGELOG 2026-10-11) still stand. ADR 0023's
"Consequences" says "about 1.2 MB per 300 workouts". The B1 fixture, which has richer sets than the ADR's estimate
assumed, exports 24.9 MB of Your data for 416 workouts. The ADR estimate should be updated when it is measured on the
phone.

VERDICT: PASS

# Review round 6: Your data: Export, Delete my data, Reset coaching knowledge (claude/your-data)

Reviewer: independent reviewer agent, 11 Oct 2026.
Scope: `claude/gracious-knuth-joxqpw...claude/your-data` at `d722072`. Main (`2009d16`) is fully merged in (`0f1a649`).
This round focuses on the round-5 fix commits `bc22d8d` (code and tests) and `d722072` (ADR 0023, CHANGELOG). I also
re-checked the round-3 B1 and S1–S3 fixes on the current HEAD, the ADR number and migrations against main, and
CLAUDE.md rules 7 and 10 end to end. Checked against `docs/reviews/your-data-r3.md` and `docs/reviews/your-data-r5.md`,
`docs/design/data-import-export.md` §2.6, §2.7, §3.3, §3.6 and §4.5, checks 30, 31 and 31a, and ADRs 0022 and 0023.

PASS means no blocking code defect. The merge still needs Ben's answer on ADR 0023's open questions, or his explicit
"merge as is, follow-up slice" (S2).

## Checks run

- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npx vitest run --testTimeout=120000`: exit 0. 184 files, 3725 passed, 1 todo.
- Mutation check. I ran each mutation on a hard-linked throwaway copy in the session scratchpad, outside every worktree.
  Each edit replaced the file rather than writing it in place, and `git status` in `/home/user/wt-data` stayed clean.
  For each mutation I re-ran `your-data`, `your-data-views`, `data-domain-service`, `restore`, `backup-service`,
  `credential-port` and `data-domains` (101 tests). For M13–M14 I ran `your-data`, `data-domain-service`,
  `device-bindings` and `personal-files` instead.

| # | Mutation | Result |
|---|---|---|
| M1 | `rollback` after a reset goes back to the whole-file swap (r5 S1) | 8 tests fail |
| M2 | `resetKnowledge` never refuses `kept_copy_at_risk` (r5 B1) | 1 test fails |
| M3 | Reset service skips the `kept_for_undo` backup (r5 B1) | 1 test fails |
| M4 | Kept-copy loss always matched `absent`, so changed records in a copy kept by a restore aren't counted | **No test fails** (S1) |
| M5 | `signOutAndWipe`: wipe moved out of `finally` (r5 S2) | 2 tests fail |
| M6 | `undoBlock`: the reset-specific "any unfinished workout" branch removed | No test fails. This is defensive only (N3). |
| M7 | `swapKnowledge` drops in-use knowledge exercises the old knowledge lacks | 1 test fails |
| M8 | `kept_for_undo` backup rotated (kind `automatic`) | 1 test fails |
| M9 | The Undo-last-reset confirmation reuses the restore text | 2 tests fail |
| M10 | A later full Delete doesn't clear an earlier `Continue` (r3 S1) | 1 test fails |
| M11 | `DELETE_STEPS` back in the old order, Keychain last (r3 B1) | 2 tests fail |
| M12 | Service passes `dropKeptCopy: true` always | No test fails. This is defence in depth only (N3). |
| M13 | `finishDelete` stops at the first failed step after the swap (r3 B1) | 3 tests fail |
| M14 | `runLeftover` (`Finish deleting`) stops at the first failure (r3 B1) | 1 test fails |

- **ADR number.** No clash. The branch's ADR is `docs/decisions/0023-delete-and-reset-by-data-domain.md`. Main's highest
  ADR is `0022-pre-start-draft.md`. No other local branch has an ADR 0023. The branch still edits main's
  `0022-pre-start-draft.md:86` as a marked cross-reference (r5 N1, unchanged).
- **Migrations.** No clash. The training schema is exactly main's 1–7 (`0007-pre-start-drafts`). `git diff` against
  main shows no change under `packages/persistence/src/schema/` or in `migrations.ts`. The only new migration is meta
  migration 3 (`manager.ts:49`, `reset switch reason`), and main's meta list stops at 2.

## Earlier findings

| Finding | Status |
|---|---|
| r3 B1: Keychain wipe blocked by an earlier step, including a stuck tmp/Caches entry | **Fixed and tested.** `coach_sign_in` runs straight after the swap (`data-domain-service.ts:93`). Every later step runs even when one fails, in both `finishDelete` (`:399–424`) and `runLeftover` (`:470–500`). The wipe is in a `finally` (`:449–452`). M5, M11, M13 and M14 are all caught. |
| r3 S1: stale `Continue` record after a later full Delete | Fixed and tested (M10). |
| r3 S2: `emptyTemporaryFiles` too strict | Fixed and tested (r5). The device check is still to do. ADR 0023 now says "still unverified on the device". |
| r3 S3: test gaps (Finish deleting during a workout, `readThenDelete`) | Fixed. M13 catches the mid-workout case. |
| r5 B1: Reset silently deletes the copy kept for Undo | **Fixed and tested.** `domainSummary().keptForUndo` (`manager.ts:496–505`, `:544–551`) counts Your data that only that copy holds. `resetKnowledge` refuses with `kept_copy_at_risk` unless `dropKeptCopy` is passed (`:626–630`). The service saves the copy first as a `kept_for_undo` backup (kind `manual`, never rotated), then makes `before_reset` (`data-domain-service.ts:677–688`). If either backup fails, nothing is reset. The alert names what the copy holds (`data-domain-view.ts:68–83`). The stamp covers the slots, so the alert Ben saw is the one that applies. Scenarios A and B are both tested at the database and app levels. One test gap remains (S1). |
| r5 S1: Undo last reset reverts Your data | **Fixed and tested.** `swapKnowledge` (`manager.ts:461–478`) builds a new file from the phone's current Your-data rows plus the other file's Coaching knowledge, plus the knowledge exercises in use that the other file lacks. It integrity-checks the file and switches to it. The test asserts that Your data is identical before and after both Undo and redo, that Coaching knowledge equals the pre-reset state, that integrity holds, and that only two files remain (`data-domains.test.ts:541`). The confirmation now says `Your data isn't changed.` |
| r5 S2: no test for a throwing sign-out | Fixed (M5 caught by two tests). |
| r5 S3: ADR Proposed, Ben questions open | Still open, now with eight items (S2). |
| r5 N2, N3 | Fixed (the `settlesWithin` comment, and the probe key deleted in a `finally`). |

## Rule 7 and rule 10, end to end

- **Rule 7 holds.**
  - `KEYCHAIN_KEYS` (`apps/mobile/src/ai/keychain.ts:32`) is the only list. A source scan fails on any undeclared key.
    The only other SecureStore use is the probe, which now deletes its key in a `finally`.
  - Items are `WHEN_UNLOCKED_THIS_DEVICE_ONLY` with their own service.
  - The wipe reads every key back and runs even when the sign-out throws or hangs (bounded at 10 s). It is the first
    step after the swap, and no later step can skip it.
  - Reset and Undo last reset never touch credentials. No credential reaches SQLite, files, backups or exports.
  - Small gap: N1.
- **Rule 10 holds in storage, export, Delete, Reset and now Undo last reset.**
  - Every table is classified and checked against `sqlite_master`. `pre_start_drafts` is Your data.
  - Export writes one domain.
  - Delete keeps owner-less knowledge rows byte-identical.
  - Reset keeps every Your-data row.
  - Undo and redo of a reset change only Coaching knowledge (tested with `filterDomain` equality).
  - The `kept_for_undo` backup is labelled `Copy kept for Undo, saved before Reset` and is removed by Delete's
    `backups` step like any other on-phone backup.

## Blocking

None.

## Should fix

**S1. No test proves that a copy kept by a restore counts records that differ, not only records that are missing.
If that check regresses, Reset silently drops Ben's newer version of a workout.**
`manager.ts:550` picks `match: 'either'` for a copy kept by a restore or its Undo, and `'absent'` for a copy kept by
Reset or its Undo. Mutation M4 forces `'absent'` everywhere, and every test still passes. The test named
"the restored backup's own records are counted too" (`packages/persistence/test/data-domains.test.ts:631`) says in its
comment that differing records count. However, its only record (gym 3) is missing from the phone, not different.

- Failure scenario (after a regression like M4):
  1. Ben corrects a set in last Tuesday's workout.
  2. He restores an older backup in which that workout has the old values. The copy kept for Undo now holds the
     corrected version.
  3. He taps Reset coaching knowledge. The alert names nothing, no `kept_for_undo` backup is made, and the corrected
     workout is deleted with the copy.
  This breaks rule 2 (completed sets changed silently), and §3.3's promise that nothing is deleted without the preview
  saying so.
- Fix: add a database-level test in which the kept copy and the phone hold the same workout ID with different set
  content (or the same gym with a different name). Assert that `keptForUndo.workouts` (or `otherRecords`) is 1, and that
  `resetKnowledge` without `dropKeptCopy` returns `kept_copy_at_risk`.

**S2. ADR 0023 is still Proposed, with eight items open for Ben.**
They are recorded in ADR 0023 "For Ben" and in `docs/brief/CHANGELOG.md` (2026-10-11):

- Export JSON-only.
- The pre-delete safety net.
- Reset and playbook candidates.
- §4.5 step order.
- Reset and today's edits.
- Knowledge-only Undo last reset (new).
- Reset with Undo last restore pending (new).
- B12.

This is not a code defect. Before merge, the PM needs Ben's answers, or an explicit "merge as is, follow-up slice".
The ADR's status line still says "the Export scope and three spec questions", which no longer matches the list (N4).

## Nits

- **N1. `wipeKeychain` stops at the first delete that throws** (`apps/mobile/src/ai/keychain.ts:36`). If deleting the
  registration throws, the tokens key is never tried in that call. Every retry (`Finish deleting`) would stop at the
  same place. The sign-out's own `deleteTokens` usually removes the tokens first, but not when the sign-out itself
  threw (the r5 S2 case). Try every key, then read back, then throw once.
- **N2. Each `kept_for_undo` backup is kept forever, even when Reset doesn't go ahead.** If `before_reset` fails, or the
  Reset comes back stale after the `kept_for_undo` backup was written (`data-domain-service.ts:679–688`), that backup
  stays. A retry writes another one, and none are ever rotated. Until a newer backup exists, it is also the "newest"
  file that the launch catch-up compares against (`backup-service.ts:351–352`). It may hold more finished workouts
  than the phone does (it is pre-restore data), so the catch-up could be skipped. Suggested fix: reuse an existing
  `kept_for_undo` backup with the same content hash. Also, leave out `kept_for_undo` when choosing `newest` for the
  catch-up.
- **N3. Two code paths are defensive only and untested** (M6 and M12). `undoBlock`'s reset branch
  (`restore-service.ts:83`) can only change the result for an unfinished workout that predates the reset, and Reset
  refuses those. `dropKeptCopy: kept !== null` matters only if the kept copy changes between summary and Reset, and the
  stamp prevents that. Both are fine to keep. A one-line comment saying so would stop a later reader from treating them
  as tested behaviour.
- **N4. The ADR 0023 status line is stale** (`docs/decisions/0023-delete-and-reset-by-data-domain.md:3`). It says
  "Export scope and three spec questions", but the "For Ben" section now has eight items.
- **N5. `domainSummary` now reads and fingerprints the whole copy kept for Undo on every call** (`manager.ts:496–505`).
  That covers Data & backup, the Delete and Reset screens, and the two "did the switch happen?" checks inside Delete
  (`data-domain-service.ts:372`, `:602`). After a large FitNotes import this doubles the read on each screen open.
  Delete doesn't need `keptForUndo`. Consider an option that skips it, or computing it lazily for Reset only. Check the
  timing on the device.
- **N6. Delete leaves a to-review playbook candidate whose `createdByActionId` points at a deleted `coach_actions`
  row.** If the coach later proposes the same rule, `creatorOf` (`packages/persistence/src/coach.ts:424–427`) finds no
  action and returns `already_exists`. The coach then reports a duplicate it can't show. This is harmless, but it is a
  dangling reference introduced by Delete. Either tolerate a missing creator there, or note it for the
  playbook-approval slice.

## Spec issues

1. **§3.6 "Undo last reset" mechanism.** The spec says it is "the same mechanism as Undo restore" (a whole-file swap).
   The code now restores Coaching knowledge only, which is the only way to keep check 31a's promise. This is recorded
   for Ben in ADR 0023 and the CHANGELOG. §3.6 should be updated once he confirms.
2. **§3.6 Reset with Undo last restore pending.** The spec is silent on this. The code replaces the restore's Undo copy,
   and when that copy holds data that isn't on the phone, it names that data and backs it up first. This is recorded for
   Ben, with alternatives.
3. Carried over, awaiting Ben:
   - The §4.5 step order.
   - The pre-delete safety net.
   - Reset and playbook candidates.
   - B12 (custom exercises and aliases).
   - The "cached import files" wording.
   - Reset and pre-start drafts.
   - Playbook candidate text may come from Ben's own words (`statedBy: 'ben'`), and it survives Delete as Coaching
     knowledge. Rule 10 classes it as general, but the spec should state this explicitly, so Ben knows Delete keeps it.

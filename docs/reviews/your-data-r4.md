VERDICT: CHANGES NEEDED

# Review round 4: Your data: Export, Delete my data, Reset coaching knowledge (claude/your-data)

Reviewer: independent reviewer agent, 11 Oct 2026.
Scope: `claude/gracious-knuth-joxqpw...claude/your-data` at `0f1a649`, which merges main (`2009d16`, today-only edits and
pre-start drafts) into the branch. Focus: the round-3 fix commits `beb8fdc`, `3fb70d8` and `a92caf9`, and how the
branch interacts with main after the merge. Checked against `docs/reviews/your-data-r3.md`,
`docs/design/data-import-export.md` §2.6, §2.7, §3.6, §4.5 and checks 30, 31 and 31a, CLAUDE.md rules 5, 7 and 10, and
ADR 0022 on both sides of the merge.

## Checks run

- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npx vitest run --testTimeout=120000`: **exit 1.** 183 files, 3699 passed, **1 failed**, 1 todo. The failure is
  `packages/persistence/test/data-domains.test.ts > every table at the current schema belongs to exactly one rule`.
  The diff shows `+ "pre_start_drafts"` on the `sqlite_master` side (see B1).
- Mutation check. I ran this on a throwaway copy outside every worktree, then deleted the copy. For each mutation I
  re-ran `your-data`, `device-bindings`, `your-data-views` and `data-domain-service` tests.

| Mutation | Result |
|---|---|
| Old step order (`coach_sign_in` last) and stop at the first failure (the round-3 code) | **6 tests fail**, including the r3 B1 test `a settings-files step that always fails never keeps the ChatGPT sign-in`. The B1 test fails without the fix. |
| Stop at the first failure only (new order kept) | 1 test fails (`Finish deleting during a workout…`). |
| Remove the S1 clearing of earlier `Continue` records | 1 test fails (`a later full Delete clears an earlier Continue`). |
| `emptyTemporaryFiles` fails on any entry iOS keeps | 1 test fails (`emptyTemporaryFiles reports, but doesn't fail on, entries iOS keeps`). |
| `Finish deleting` cancels every alert, including the active workout's | 1 test fails (`Finish deleting during a workout…`). |
| Drop the resumed `signedOutOnline` fallback | 1 test fails. |
| `runLeftover` stops at its first failure | **No test fails** (N2). |
| `runLeftover` `backups` uses `wipeOnPhone` instead of `removeOnPhoneBefore` | **No test fails** (N3). |

- Migrations. This branch adds no training-schema migration. The schema list is main's 1–7, ending with
  `7 pre-start-drafts`, so there is no clash. Meta migration 3 (`database_slots_v3`, `manager.ts:52`) is new on this
  branch. Main's meta list stops at 2, so meta migrations don't clash either.

## Round 3 findings

| Round 3 | Status |
|---|---|
| B1 Keychain wiped last, blocked by earlier steps | **Fixed.** `DELETE_STEPS` is now `database, coach_sign_in, alerts, backups, settings_files` (`data-domain-service.ts:91`). After the swap every step runs, and every failure is recorded (`:326–356`). `runLeftover` does the same (`:398–431`). The test `your-data.test.ts:326` makes `settings_files` always fail and asserts an empty Keychain after Delete, after `Continue` and after `Finish deleting`. It fails on the round-3 code (mutation table above). A tmp or Caches failure can no longer block the wipe. |
| S1 stale `Continue` record after a later full Delete | **Fixed** (`:362–364`) and tested (`your-data.test.ts:350`). The mutation is caught. |
| S2 `emptyTemporaryFiles` too strict | **Fixed** as suggested. Only the picker `*-Inbox` is checked strictly, and other survivors are returned (`files.ts:116–141`). Tested both ways. I confirmed in `node_modules/expo-file-system/ios/FilePickingUtils.swift:79` that `File.pickFileAsync` uses `UIDocumentPickerViewController(…, asCopy: true)`, so the inbox assumption holds. `tmp` sits outside expo's scoped directories, so writes defer to iOS (`FileSystemUtilities.swift:106`). That still needs the device check the ADR lists. |
| S3 tests | **Fixed** for all four gaps: always-failing step before the Keychain, later Delete clearing `Continue`, `Finish deleting` mid-workout with relaunch recovery, and `readThenDelete` when delete throws. Two small gaps remain (N2, N3). |
| S4 ADR Proposed, Ben questions open | **Still open, correctly parked** (S2 below). |
| N1–N3 | Fixed (`Signs you out of ChatGPT.` only when `coach_sign_in` is left; other `fizz.rest.` alerts cancelled; shorter line). |
| N4 SplashBoard snapshot | Added to the ADR device checks. |

## Rule 7 and rule 10, end to end

- **Rule 7: holds.**
  - `KEYCHAIN_KEYS` (`keychain.ts:32`) is the only list. Only `keychain.ts` and the probe (which deletes its own key
    straight away) call SecureStore.
  - `wipeKeychain` reads back. `signOutAndWipe` wipes in a `finally`, so a throwing sign-out still clears the Keychain.
    It now runs first after the swap and can't be skipped by a later step.
  - The revoke is bounded and writes nothing locally. Reset never touches credentials.
  - No credentials go to SQLite, files or backups.
- **Rule 10: broken by the merge** (B1). Main's migration 7 adds `pre_start_drafts`, an owner-scoped Your-data table
  (`schema/0007-pre-start-drafts.ts:5`). `data-domains.ts` doesn't classify it. Otherwise the domain split holds:
  `sessions.today_edits` and `session_sets.skipped_by` are columns of Your-data tables, and the new `update_routine`
  coach-action kind sits in `coach_actions` (Your data).

## Blocking

**B1. After the merge, `pre_start_drafts` is unclassified. Once Ben saves one today-only edit, Data & backup, Delete,
Reset and Export all throw, permanently.**
`packages/persistence/src/data-domains.ts:25–58` doesn't list `pre_start_drafts`. `filterDomain` (`:78–81`) calls
`domainOf` per row, so an empty table passes and a single row throws `UnclassifiedTableError`. Draft rows are never
deleted: they move to `consumed`, `discarded` or `expired` (`drafts.ts`, `sessions.ts:469–476`). So the first Swap, Skip,
Do first or Reorder on the overview breaks the feature for good.

- Failure scenario: Ben swaps an exercise for today on the overview, then opens Data & backup.
  - `manager.domainSummary` (`manager.ts:444`, via `countDomains`) throws, so the Delete and Reset screens can't load
    their counts or stamp.
  - `deleteYourData` (`:469`), `resetKnowledge` (`:494`) and `exportDomain` (`data-domains.ts:150`) throw the same way.
  - Delete my data can't run, which breaks rule 10 and check 30. `Export: My data` fails.
  - If a Delete marker is pending, `resumeInterrupted` can't check `yourData.records` after a failed swap.
- The suite catches this: the classification test fails on this branch. The branch can't merge red.
- Fix:
  - Add `pre_start_drafts` to `YOUR_DATA_TABLES` (it has `owner_id NOT NULL` and holds Ben's choices).
  - Add a Delete, Reset and Export test with a saved draft row, so this path is covered beyond the `sqlite_master`
    comparison.
  - Because a draft's `data` stores swap exercise IDs, assert that Reset keeps a knowledge exercise a draft points to.
    `knowledgeExercisesInUse` scans every Your-data row, so this should hold once the table is classified.
  - Also see S1, which appears once this is fixed.

**B2. Two ADRs are numbered 0022.**
After the merge, `docs/decisions/` has both `0022-pre-start-draft.md` (main, Accepted pending Ben, referenced across
main's code and design docs as "ADR 0022 §5") and `0022-delete-and-reset-by-data-domain.md` (this branch, Proposed).
Each code comment that says "ADR 0022" is now ambiguous. `manager.ts` has both kinds side by side: `:48` means this
branch's ADR, and `:381` and `:419` mean main's. The CHANGELOG entry ("Details in ADR 0022") is ambiguous too.

- Fix: main's 0022 landed first and is widely referenced, so renumber this branch's ADR to **0023**. Update the
  references: `data-domain-service.ts:26`, `files.ts:114`, `ExportScreen.tsx:16`, `manager.ts:48`,
  `docs/brief/CHANGELOG.md` (2026-10-11 Your data entry), and the round-1 to round-3 review files if you want them
  consistent.

## Should fix

**S1. Reset (and `Undo last reset`) now silently discards Ben's saved pre-start draft.**
The merge added `discardOpenDrafts(fresh.db)` inside `DatabaseManager.build` (`manager.ts:381`) and in `rollback`
(`:419`). This was meant for Restore, but `resetKnowledge` uses the same `build` (`:503`), and Undo last reset uses
`rollback`.

- Failure scenario: once B1 is fixed, Ben saves today's edits (a swap and a reorder) and taps Reset coaching knowledge
  before starting. The Your-data draft row is changed to `discarded`, and today's edits are gone. ADR 0022 (this
  branch) promises Reset "keeps every Your-data row", and DX4 only blocks Reset for an unfinished workout.
- Side effect: `resetKnowledge`'s `unchanged` check (`:504–510`) compares hashes. A discarded draft changes the hash,
  so a no-op Reset becomes `switched` with a rollback generation.
- Fix:
  - Discard drafts only when `purpose === 'restore'`. Pass the reason into `build`, or call `discardOpenDrafts` from
    `restore` itself.
  - Either keep drafts through Reset and its Undo, or make it an explicit, tested decision in both ADRs.
  - Test: Reset with an open draft keeps it `open` at the same version, and a no-op Reset with a draft returns
    `unchanged`.

**S2. ADR (to be 0023) is still Proposed, and five Ben questions are open.**
The open questions are Export JSON-only, the pre-delete safety net, Reset and candidates, step order, and B12. They are
correctly recorded in the ADR "For Ben" section and the CHANGELOG. This needs Ben's answer, or an explicit "merge as is,
follow-up slice", before merge. It is not a code defect.

## Nits

- **N1.** `createPersonalFiles().remove()` (`personal-files.ts:40–47`) runs `removeDocuments` → `removeDatabaseFiles` →
  `emptyTemporary` and stops at the first throw. A stuck `device-prefs.json` therefore keeps the picker inbox copies,
  which can hold Ben's full FitNotes history. Apply the r3 "every part runs, report the first failure" rule inside the
  step too.
- **N2.** No test proves that `runLeftover` keeps going after a failed step. Making it stop at the first failure passes
  every test. Add a `Finish deleting` case where `alerts` fails and assert that `settings_files` still ran.
- **N3.** The r2 S2 test (`your-data.test.ts:245`) doesn't distinguish `removeOnPhoneBefore` from `wipeOnPhone`.
  `wipeOnPhone` re-creates a backup with the same file name at the same clock, so `fresh` still "survives". Advance
  `h.clockMs` before `finishLeftover`, or assert that the fresh file's content hash and `reason` are unchanged.
- **N4.** `signOutAndWipe` bounds the online revoke but not `credentials.signOut()` itself. A hung Keychain read would
  hang Delete behind the cover. This is unlikely, so a device check is enough.

## Spec issues

1. **Pre-start drafts vs Reset/Restore (new).** `overview-today-edits.md` / main's ADR 0022 §5 say a *restore* discards
   open drafts. Neither spec says what Reset coaching knowledge or Delete does to them. Delete removes them as Your
   data, which is fine. Reset needs a line, keep or discard (S1).
2. **§4.5 step order, pre-delete safety net, Reset and candidates, B12, "cached import files" wording.** These are
   unchanged from round 3 and recorded as awaiting Ben.

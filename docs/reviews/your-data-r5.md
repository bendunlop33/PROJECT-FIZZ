VERDICT: CHANGES NEEDED

# Review round 5: Your data: Export, Delete my data, Reset coaching knowledge (claude/your-data)

Reviewer: independent reviewer agent, 11 Oct 2026.
Scope: `claude/gracious-knuth-joxqpw...claude/your-data` at `b60201f`. Main (`2009d16`) is fully merged in, and nothing on
main is missing from the branch. This round focuses on the round-4 fix commits `e3c2765`, `6c8b4f7`, `b0d11bf` and
`b60201f`. I also re-checked the round-3 B1 and S1–S3 fixes on the current HEAD, the migrations against main, and
CLAUDE.md rules 7 and 10 end to end. Checked against `docs/reviews/your-data-r3.md`, `docs/reviews/your-data-r4.md`,
`docs/design/data-import-export.md` §2.6, §2.7, §3.3, §3.6 and §4.5, checks 29a, 30, 31 and 31a, and both ADRs (0022 and
0023).

## Checks run

- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npx vitest run --testTimeout=120000`: exit 0. 184 files, 3710 passed, 1 todo.
- Mutation check. I ran each mutation on a hard-linked throwaway copy in the session scratchpad, outside every worktree,
  and deleted the copy afterwards. For each one I re-ran the `your-data`, `personal-files`, `device-bindings`,
  `data-domain-service`, `your-data-views` and `data-domains` tests (72 tests).

| Mutation | Result |
|---|---|
| `pre_start_drafts` removed from `YOUR_DATA_TABLES` (r4 B1) | 5 tests fail, including the app-level draft test |
| `build` discards drafts for every purpose (r4 S1) | 3 tests fail |
| `rollback` always discards drafts (r4 S1, Undo last reset) | 2 tests fail |
| `createPersonalFiles().remove()` stops at the first failure (r4 N1) | 1 test fails |
| `runLeftover` stops at the first failure (r4 N2) | 1 test fails |
| `runLeftover` `backups` uses `wipeOnPhone` (r4 N3) | 1 test fails |
| `signOut()` not bounded (r4 N4) | 1 test fails (times out) |
| `finishDelete` stops at the first failed step after the swap (r3 B1) | 2 tests fail |
| `DELETE_STEPS` back in the old order, Keychain last (r3 B1) | 2 tests fail. The ledger-migration test also catches it. Because every step now runs, the order alone no longer decides whether the Keychain is wiped. |
| No clearing of earlier `Continue` records (r3 S1) | 1 test fails |
| `emptyTemporaryFiles` fails on any entry iOS keeps (r3 S2) | 1 test fails |
| `signOutAndWipe`: wipe moved out of `finally`, so a throwing sign-out skips it | **No test fails** (S2) |

- I wrote two throwaway probe tests, one for B1 and one for S1, against `DatabaseManager` in
  `packages/persistence/test/`. Both failed as predicted, and I deleted them. They are not committed.
- Migrations. There is no training-schema migration on this branch. The schema list is main's 1–7, ending with
  `0007-pre-start-drafts`. Meta migration 3 (`manager.ts:49`, `reset switch reason`) is new here, and main's meta list
  stops at 2. Nothing clashes.
- ADR numbering. Fixed. The branch's ADR is now `0023-delete-and-reset-by-data-domain.md`. Every "ADR 0022" left in
  `apps/` and `packages/` refers to main's pre-start draft ADR. The CHANGELOG names 0023 and gives the reason for the
  renumber.

## Earlier findings

| Finding | Status |
|---|---|
| r3 B1: Keychain wipe blocked by an earlier step | **Fixed and tested.** `DELETE_STEPS` puts `coach_sign_in` straight after the swap (`data-domain-service.ts:91`). Every step after the swap runs, in both `finishDelete` (`:387–405`) and `runLeftover` (`:458–487`). A `settings_files` step that always fails, including a stuck tmp or Caches entry, can't keep the sign-in (`your-data.test.ts:333`). One gap remains: a sign-out that throws (S2). |
| r3 S1: stale `Continue` after a later full Delete | Fixed and tested (`your-data.test.ts:392`). |
| r3 S2: `emptyTemporaryFiles` too strict | Fixed and tested both ways (`files.ts:116–141`, `device-bindings.test.ts`). |
| r3 S3: tests (Finish deleting order, mid-workout, `readThenDelete`) | Fixed. The r4 N2 and N3 gaps are now covered too (mutation table above). |
| r4 B1: `pre_start_drafts` unclassified | **Fixed.** It is classified as Your data (`data-domains.ts:53–54`). Tests cover the database level (`data-domains.test.ts:200`) and the app level: Data & backup, Export, Reset, Undo and Delete with a saved draft (`your-data.test.ts:741`). Reset keeps the knowledge exercise a draft swaps to. |
| r4 B2: duplicate ADR 0022 | **Fixed** (see Checks run). |
| r4 S1: Reset and Undo discard drafts | **Fixed.** Drafts are discarded only when `purpose === 'restore'` (`manager.ts:383`), and `rollback` skips the discard for `reset` and `undo_reset` (`:423–425`). A no-op Reset with an open draft is `unchanged`. Recorded in ADR 0023 and as a question for Ben. |
| r4 S2: ADR Proposed, Ben questions open | Still open (S3 below). |
| r4 N1–N4 | Fixed and tested (mutation table above). |

## Rule 7 and rule 10, end to end

- **Rule 7: holds in code.** It has one test gap (S2).
  - `KEYCHAIN_KEYS` (`keychain.ts:32`) is the only list. The ChatGPT vault moved from `chatgpt-test-ports.ts` into
    `keychain.ts`, so there is one place that writes. The only other SecureStore use is the probe
    (`probe/runners.ts:148–158`), which deletes its own key after one read.
  - A source scan in `device-bindings.test.ts` fails on any undeclared key.
  - `wipeKeychain` reads every key back and throws if one is left.
  - The sign-out and the online revoke are each bounded at 10 s. The wipe runs in a `finally`. The step runs first after
    the swap and can't be skipped by later steps.
  - Reset never touches credentials, and no credential reaches SQLite, files, backups or exports.
- **Rule 10: holds in storage, export and Delete. It does not hold for Reset's Undo (B1, S1).**
  - Every table is classified, and `sqlite_master` is compared against the list. `pre_start_drafts` is now Your data.
  - Export writes one domain only.
  - Delete keeps the owner-less knowledge rows byte-identical.
  - Reset builds a new file with Your data identical.
  - `Undo last reset` and the generation that Reset drops, however, are whole-database swaps. They move or delete
    Your data while the UI says only coaching knowledge changes.

## Blocking

**B1. Reset coaching knowledge silently and permanently deletes the database kept for Undo, including any workouts that
exist only there. The confirmation says "Your data isn't changed."**
`resetKnowledge` switches with `switchTo` (`packages/persistence/src/manager.ts:515`). `switchTo` (`:566–568`) moves the
current rollback generation (`previous`) to the orphan slot as `dropped`, and the file is then removed. Restore's
preview counts what is only in that copy (`keptForUndo`, `manager.ts:598–617`, `backup/replace.ts:144–156`), and spec
§3.3 (line 286) says "Data is never deleted without the preview saying so". Reset does no such check. Its confirmation
(`apps/mobile/src/backup/data-domain-view.ts:59`) says `Your data isn't changed.` The `before_reset` backup copies only
the *current* database, not the generation being dropped.

- Failure scenario A (probe-confirmed):
  1. Ben taps Reset coaching knowledge.
  2. The next day he logs a workout.
  3. He taps `Undo last reset`. The workout is now only in the switched-away file (S1).
  4. Later he taps Reset again. `training-2.db`, which holds that workout, is deleted, and the files left are
     `training-1.db` and `training-3.db`.
  The completed workout is gone from the phone with no warning, and no backup on the phone has it. My probe used a
  saved gym in place of the workout: `expected null not to be null`.
- Failure scenario B:
  1. Ben restores an older backup. `Undo last restore` keeps his pre-restore data, which may include workouts that
     aren't in the backup.
  2. Before deciding whether to undo, he resets coaching knowledge. The pre-restore copy is deleted, and
     `Undo last restore` disappears.
- This breaks rule 2 (completed sets are removed silently) and rule 10 (a Coaching-knowledge action deletes Your data),
  and check 31a ("leaves every owner-scoped record identical"). Reset is new on this branch, so the issue is too.
- Fix (pick one, and test it):
  - Preferred: make Reset (and Undo last reset, see S1) knowledge-only. Undo should build a new file from the
    *current* Your-data rows plus the pre-reset Coaching-knowledge rows, not swap files. Reset should then only drop a
    generation that holds no Your data missing from the current database.
  - Minimum: before Reset, compute `keptForUndo` against the current data, as restore does. When the copy kept for
    Undo holds any Your-data record that isn't on this phone, either refuse with a short line, or name the loss in the
    confirmation (`The data kept for Undo (… since Sat 10 Oct) holds 1 workout that isn't on this phone. Reset deletes
    that copy.`) and back it up first (`before_reset` of the previous generation).
  - Tests: Reset after Restore with a pre-restore-only workout, and Reset → log → Undo last reset → Reset. Assert that
    the workout survives or that the warning and backup happen.

## Should fix

**S1. `Undo last reset` reverts Your data logged since the reset, while the row says it brings back coaching
knowledge.**
`rollback` (`manager.ts:408–440`) swaps whole database files for `reset` and `undo_reset`, just as for a restore. The
row (`apps/mobile/src/backup/restore-view.ts:207–208`) says `Brings back coaching knowledge from before <when>`. The
confirmation (`DataBackupScreen.tsx:106`) adds `Anything logged since then stays only in the data you switch away
from…`, so the move is disclosed. Even so, completed workouts, pain flags and memories disappear from History after an
action labelled as a knowledge change. The only way back is `Switch back to the reset coaching knowledge`, which in
turn reverts the knowledge. Combined with B1, that copy can then be deleted.

- Failure scenario (probe-confirmed): Reset, then save a gym (or log a workout), then Undo last reset. The gym is gone.
- `undoBlockedBy` blocks only for an unfinished workout started since the switch. It doesn't block for finished
  workouts.
- Fix: the knowledge-only Undo from B1. Failing that, block Undo last reset once any Your-data record has been written
  since the reset (compare against the stamp at reset time), and say so in one short line. Also see Spec issue 1.

**S2. No test proves the Keychain is wiped when the sign-out itself throws.**
`signOutAndWipe` (`apps/mobile/src/backup/data-domain-service.ts:426–441`) wipes in a `finally`, which is correct.
However, moving the wipe out of the `finally`, so that a throw from `credentials.signOut()` skips it, passes every test.
On a phone, `vault.loadTokens()` or `deleteTokens()` (`credential-port.ts:15–16`) can throw: for example a Keychain
access error, or an item that can't be read while the phone is locked. The ChatGPT tokens and the registration, which
holds the account email, would then survive Delete, `Continue` and every `Finish deleting`. That breaks rule 7 and
check 30.

- Fix: add a test with a `CredentialPort` whose `signOut` rejects. Assert that the Keychain is empty after Delete, that
  the outcome names `coach_sign_in`, and that `Finish deleting` still wipes.

**S3. ADR 0023 is still Proposed, with six questions open for Ben.**
The questions are Export JSON-only, the pre-delete safety net, Reset and candidates, step order, Reset and today's
edits, and B12. They are correctly recorded in the ADR "For Ben" section and in the CHANGELOG. Before merge this needs
Ben's answer or an explicit "merge as is, follow-up slice". It is not a code defect. B1 and S1 should be added to the
Reset questions if the fix changes the behaviour the spec describes.

## Nits

- **N1.** The branch edits main's `docs/decisions/0022-pre-start-draft.md:86` (the Backups line) to say Reset and Undo last reset keep
  drafts. That is fine as a cross-reference and is marked "(ADR 0023, proposed)". When Ben answers the Reset-and-drafts
  question, remember to update or revert the line.
- **N2.** In `settlesWithin` (`data-domain-service.ts:217–233`), a sign-out that answers after the timeout still runs
  `deleteTokens` alongside the wipe. That is harmless (it only deletes), but the comment could say so, so that nobody
  later adds a write to `signOut`.
- **N3.** `runSecureStoreProbe` (`probe/runners.ts:156–158`) leaves its random key behind if `getItemAsync` throws
  between the set and the delete. It holds no personal data, but deleting it in a `finally` would make
  "every key is in `KEYCHAIN_KEYS`" strictly true.

## Spec issues

1. **Undo last reset is specified as a rollback generation** (§3.6 line 721: "the same mechanism as Undo restore"),
   but check 31a and the Reset confirmation promise that Your data is untouched. A file swap can't keep both promises
   once Ben logs anything after the reset (B1, S1). The spec should say that Undo last reset restores only Coaching
   knowledge, or that it is offered only until Your data changes. Ben to decide.
2. **Reset and the copy kept for Undo restore.** §3.3 protects the Undo copy on restore (line 286), but §3.6 doesn't say
   what Reset does to an existing `Undo last restore`. It should either keep it or warn as restore does.
3. Carried over, awaiting Ben: §4.5 step order, the pre-delete safety net, Reset and playbook candidates, B12, the
   "cached import files" wording, and Reset and pre-start drafts.

VERDICT: PASS

# Review: Workout overview, today's edits (claude/today-edits)

Reviewer: independent reviewer agent, 11 Oct 2026.
Scope: `git diff claude/gracious-knuth-joxqpw...claude/today-edits` (9790e78..7d4b71c, 6 commits, 48 files).
Checked against `docs/design/overview-today-edits.md` v0.2 (TE1–TE10, TE-A1–TE-A18), ADR 0022,
`docs/design/workout-overview.md`, CLAUDE.md rules 1–10 and the minimal-copy convention.

## Checks run

- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npx vitest run --testTimeout=120000`: exit 0. 176 files, 3613 passed, 1 todo.

## What's good

- **Migration 7 on a populated schema-6 database.** It adds a new table and two nullable columns, and rebuilds
  `coach_actions` to widen its `kind` CHECK. The rebuild copies every column, recreates all four indexes and the
  no-delete trigger, and nothing references `coach_actions` by foreign key, so the DROP/RENAME is safe.
  `drafts.test.ts` copies a real populated v6 database (a session and a coach action) and migrates it in place.
  Sessions and actions read back identical, `update_routine` is accepted, the no-delete trigger still fires and
  integrity passes. The older-backup restore tests now strip the v7 columns and table, and still pass.
- **Backup/restore.** Drafts are in the backup. On restore every `open` draft is marked `discarded` with a version
  bump, before the integrity check. An identical backup is a no-op. Tested (TE-A17).
- **Rule 2.** The routine template changes only through `applyTemplateSwap`, which the inline card's Apply calls.
  Apply is one transaction: routine v+1, a Ben-authored `update_routine` ActionRecord, and the draft edit marked
  `redundant`. It is idempotent on opId and refused on a stale routine version. Undo is version-checked
  (`Can't undo: Push A changed since.`). Today-only edits apply at once with Undo (TE3), and no completed set is
  touched.
- **Rule 4.** Edits store intent only. A swap never converts the original's load. The substitute's targets come
  from its own comparable history (bar mass included for barbells), else reps with no load. Every load goes
  through the shared `snapPlanToGym` (mode `start`). Hotel-gym caps, kg/lb on a lb rack and the assisted direction
  are tested. `swapRoutineSlot` clears the item and resets template loads to Auto.
- **Rule 5.** Every draft write carries `opId` + `expectedDraftVersion`. A duplicate returns the draft and a
  mismatch writes nothing. The draft row joins `previewKey` and the start's `WriteFence`. `closeDraftsOnStart`
  re-checks status, owner, version and expiry inside the session transaction. Any other start discards every open
  draft in that same transaction, so no start path can forget it.
- **Rule 9.** Substitute targets go through `nextTargetsFor` with pain flags and the check-in's unspecified pain.
  Flagged candidates are marked and listed last, and the pick asks first. `HELD` outranks `SWAPPED`.
- **Preview = Start.** Both go through `planWithTodayEdits` → the unchanged planner. The app-level tests compare
  the page with the session Start creates for skip, order and swap, at the main gym and at the dumbbell-only gym.
- **Force-close.** The draft survives a relaunch, and Today's Up next reads the edited preview (TE-A14, tested).
  Nothing is written as a session before Start (TE-A1, record counts unchanged).
- **Midnight.** Expiry is the next local midnight in the draft's stored tz. It is checked on read and at Start,
  with the 23:55 → 00:05 case tested at service level.
- **Every start path is otherwise unchanged.** Repeat, Empty and CheckIn starts don't pass `today`. They only gain
  the discard in the session transaction. `previewKey` hashes identically when there's no draft.
- **No AI.** The tests assert zero provider calls, and coach files and context never read drafts (rule 10).
- **Copy.** The copy is minimal: every fixed string is in the §5 table, and there are no explanation lines.

## Blocking

None.

## Should fix

**S1. `Bench press · planned` in `Swap again` doesn't restore the planned exercise after two swaps.**
`apps/mobile/src/screens/workout/WorkoutOverviewScreen.tsx:519` sends `undoEdit(current.edit.editId)`.
`packages/domain/src/session/today-edits.ts:222-231` then brings back the edit that one *replaced*.
Scenario: bench is taken, so Ben swaps it to DB bench. The dumbbells are taken too, so he uses Swap again to pick
chest press machine. When the bar frees up he opens Swap again and taps `Bench press · planned`. The row becomes
`DB bench press ⇄ SWAPPED`, not bench. The row is labelled as the planned exercise but does something else.
Fix: for the planned row, send one write that removes the whole live swap chain for the slot (e.g. a
`clear_swap {slotKey}` command, marked `undo`), and keep step-wise Undo only for the toast. Add a chain test.

**S2. `Earlier edits cleared` never shows when Start runs after midnight from the screen.**
In `apps/mobile/src/workout/overview-start.ts:70/73`, `ports.reload()` is the read that expires the draft and
returns `cleared: true`. Its page is then dropped. `WorkoutOverviewScreen.tsx:289-290` shows `Targets updated`
and calls `reload()` again, and that second read returns `cleared: false`. TE-A15 and the §3 row ("Start after
midnight … toast `Earlier edits cleared`") aren't met. The TE-A15 test calls `overview.start` and `load` directly,
so it misses this.
Fix: when `r.kind === 'stale'`, use `r.page` (set it as the page, and let `pageToast` pick `cleared`) instead of
re-loading, or prefer the cleared toast when the stale page has it. Add a test through `startFromOverview`.

**S3. The substitute's "last used here" item is missing from the dry run and Start, but present in the Swap sheet.**
`substituteCtx` (`workout-services.ts:1177`) builds `lastUsedHere` for the substitute. `routineStart`
(`:1012`), the next-session dry run (`:1267`) and Start (`:1375`) build it only for the original exercises.
`mapEquipment` (`packages/domain/src/session/snap.ts:181`) uses it whenever the pinned item isn't at this gym.
Scenario: the newest DB bench history is at Hotel gym, and Main gym has two dumbbell racks with Ben's usual one
second in the list. The sheet fits to the usual rack, but the row and Start fit to the first rack, so the target
can differ (TE-A5) and GS3 step 2 is skipped. Loads stay achievable, so this isn't a rule-4 break.
Fix: in `routineStart`, the next dry run and Start, include every swap edit's `toExerciseId` in `lastUsedFor`'s
ids, or pass `lastUsedHere` through `TodayEditsInput`. Add a two-rack test.

**S4. Undoing the template change silently replaces a newer today-swap on the same slot.**
`packages/persistence/src/drafts.ts:174` restores the old swap with `restore`, and
`today-edits.ts:254-257` replaces any live swap on that slot (`replaced`).
Scenario: Ben applies `Change Push A too ›` (bench → DB bench), then swaps the slot to machine press for today,
then taps the card's still-visible `Undo`. The routine goes back to bench, but today's slot becomes DB bench, and
his machine-press pick is gone without a word.
Fix: when restoring from the template Undo, skip the draft restore if the slot already has a live swap (as is done
for `skip`). Alternatively, report it in the toast.

**S5. The server accepts any `toExerciseId`, and the targets map is keyed by exercise.**
`overview.edit` (`workout-services.ts:2436`) only checks that the exercise exists. The exclusions (already in
today's plan, doable here, same measurement) live only in `rankSubstitutions`. In
`applyTodayEditsToRoutine` (`today-edits.ts:534`), `targets.set(sp.exercise.id, sp.plan)` overwrites the targets
of any other slot with that exercise.
Scenario: Ben swaps bench → DB bench today, then adds DB bench to Push A in the routine editor. The other DB bench
slot now gets the substitute's plan, with the bench slot's set count, instead of its own targets.
Fix: have `resolveTodayEdits` mark a swap `stale` when its exercise is already in another base slot, and validate
the same in `applyDraftCommand` for new edits.

**S6. Test gaps.**
(a) The domain TE-A2 "every combination" test (`packages/domain/test/today-edits.test.ts:646`) builds the overview
from the same `out` it checks against. It shows that the overview renders the plan, not that the dry run equals
Start. The real preview-vs-Start checks are app-level and cover three single-edit or simple-combo cases only.
(b) There are no combinations for the `next` basis, and assisted/lb conventions aren't compared with Start.
(c) Not tested: the chained `Swap again` case (S1), the screen path for TE-A15 (S2), and a v6 *backup* with
`coach_actions` rows restored through migration 7. In-place migration is covered, but the restore path isn't.
Fix: run the 8 combinations through services for both bases (dry run vs Start), and add the cases above.

## Nits

**N1.** `MAX_DRAFT_EDITS = 400` (`packages/schemas/src/draft.ts:57`) counts removed edits too, and every ↑/↓ tap
appends one. Once a day's draft reaches it, every edit fails with `Couldn't save that edit.` and nothing recovers
it. That's unlikely, but consider compacting `replaced` order edits, or starting a fresh draft.

**N2.** The `Why?` row on a swapped set reads label `Swapped` + `Before start · Bench press`. The spec copy is
`Swapped before start · Bench press`. The words are the same but split differently, so either match the spec or
update §5.

**N3.** `writeDraft` prunes with `resolveTodayEdits(base, current.edits)` without `knownExercise`. A swap to a
deleted exercise is counted in `removedEdits` from the plan but never pruned on the next write. It's harmless, but
the toast can repeat on each new version.

**N4.** Rollback after a restore brings back the previous database's open drafts as `open`. They expire by time
anyway, but for symmetry `rollback` could discard them too.

**N5.** `ensureExercise` saves a catalogue exercise as Ben's row when he picks it in the sheet, even if he undoes
straight away. This matches `Add exercise`, but it's worth noting.

## Spec issues

1. **Undo semantics conflict (S1).** §4.2 says `undoEdit` "restores the edit it replaced". §2.4 and TE-A6 say
   picking `<original> · planned` "equals Undo swap". After a chain these can't both hold. Decide whether Undo
   swap steps back one swap or returns to the plan, and keep `· planned` meaning the plan.
2. **TE-A17** says drafts are "exported and deleted with Your data". Apart from backup, there's no Your-data
   export or erase flow in the app yet. Reword it to "included in backups" until those flows exist.
3. **Building ahead of Ben's confirmation.** The spec status is "PM defaults pending Ben" and ADR 0022 is
   "Accepted pending Ben". Migration 7 is "frozen once released". If Ben picks the in-memory alternative (§10.1,
   ADR alternative 2), a released migration 7 can't be withdrawn, only left unused. Get §10.1 confirmed before this
   ships to the phone.
4. **routines.md §4.2** now routes `Swap ›` → `Change Push A` through the card (TE4). That's also listed as pending
   Ben (§10.3). The same caveat applies.

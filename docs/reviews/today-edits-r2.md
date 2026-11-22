VERDICT: PASS

# Review r2: Workout overview, today's edits (claude/today-edits)

Reviewer: independent reviewer agent, 11 Oct 2026.
Scope: the fix commits 35c5ea3, ef3ef47 and d10e5fd (`git diff 1d2d740..d10e5fd`, 12 files), checked against
`docs/reviews/today-edits.md` S1–S6 and N1–N5, `docs/design/overview-today-edits.md`, ADR 0022 and CLAUDE.md
rules 2, 4, 5 and 9, and preview == Start.

## Checks run

- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npx vitest run --testTimeout=120000`: exit 0. 177 files, 3627 passed, 1 todo (r1: 176 files, 3613 passed).
- A throwaway probe of `resolveTodayEdits` (written, run, then deleted; not committed) for R2-S1 below.

## Prior findings

| r1 | Status | Evidence |
|---|---|---|
| S1 `· planned` after chained swaps | Fixed | New `clear_swap` command (`today-edits.ts:246-253`) removes only the live swap, and the edits it replaced stay `replaced`. The screen sends `clearSwap` for both `· planned` and `Undo swap` (`WorkoutOverviewScreen.tsx:520-523, 547`), and the toast Undo still steps back one. Tests: domain `back to the plan after chained swaps` and app `S1` (bench → DB bench → second → `· planned` gives the original rows, editCount 0, duplicate opId is a no-op, an empty clear doesn't bump the version). The spec §2.4/§6.2 is updated (Spec issue 1 resolved in the PM's direction, still marked pending Ben). |
| S2 `Earlier edits cleared` on a stale Start | Fixed | The screen now shows `staleStartToast(r.page, …)` (`WorkoutOverviewScreen.tsx:290`). The follow-up `reload()` returns `cleared: false`, and `pageToast` gives `null` for it, so the cleared toast isn't overwritten. `startFromOverview` also stops retrying when the re-read is `cleared` (`overview-start.ts:72`). Test gap: see N1. |
| S3 the substitute's last-used item | Fixed | `swapExerciseIds` feeds `lastUsedFor` in `routineStart`, the next dry run, the next Start and Today's Up next (`workout-services.ts:1019, 1274, 1384, 2218`). App test `S3` (two racks, newest DB bench at Hotel gym) checks that the sheet, the row and Start agree on an odd-step load, and that Start's `equipmentId` is the usual rack. Without the fix, the row and Start would fit Rack A (even steps), so the test would fail. |
| S4 template Undo replaces a newer swap | Fixed | `restore { keepLive: true }` skips a slot that has a live edit (`today-edits.ts:276`), and `undoRoutineChange` uses it (`drafts.ts:176`). Persistence test: the routine reverts, the draft version is unchanged, and the machine swap stays. A domain test covers keepLive vs Reset-Undo. Without the flag, the test's `d4.version` check fails. |
| S5 server accepts any `toExerciseId` | Mostly fixed | `swapAllowed` re-checks measurement and `doableHere` on the server (`workout-services.ts:2318-2334`). `applyDraftCommand` refuses `in_plan`, and `resolveTodayEdits` marks a swap `stale` when another slot already has the exercise. Tests at domain and app level. One residual path remains: R2-S1. |
| S6 test gaps | Fixed | App `S6`: all 8 combinations, dry run vs Start, for both the routine and next-session bases. lb + assisted swap/skip/order vs Start. A chained-swap test, a startFromOverview midnight test, and a v6 *backup* with a `coach_actions` row restored through migration 7 (the rebuild accepts `update_routine` and still refuses deletes). |
| N3 prune ignores deleted exercises | Fixed | `writeDraft` passes `knownExercise` (`workout-services.ts:2275-2278`). |
| N4 rollback brings back open drafts | Fixed | `rollback` calls `discardOpenDrafts` (`manager.ts:362`), tested (`status: discarded`, version +1). |
| N1, N2, N5 | Open | Carried below as N2, N3 and N4. |

## Rules re-checked against the fixes

- **Rule 2.** No completed set is touched. `clear_swap` is a today-only edit and goes through the same draft write. The
  template Undo now changes *less* (it keeps Ben's newer pick), and the routine side is unchanged and version-checked.
- **Rule 4.** The new server check only narrows what's accepted. `lastUsedHere` changes which item is fitted, never
  whether the load is fitted: every load still goes through `snapPlanToGym`. The lb/assisted test confirms that
  `unit: 'lb'` and `convention: 'assistance'` come from the substitute's own history, with nothing converted from
  the stack.
- **Rule 5.** `clearSwap` is `writeDraft` with opId + `expectedDraftVersion`. A duplicate returns `duplicate: true`,
  and nothing to clear returns `unchanged` with no version bump (tested). `swapAllowed` is a read before the write.
  The write itself is still fenced.
- **Rule 9.** Unchanged: substitutes still plan through `nextTargetsFor` with pain flags, and the sheet's `May hurt`
  confirm is untouched. `clearSwap` returns to the planned exercise, whose pain hold already applies on the base path.
- **Preview == Start.** All four dry-run/Start call sites now build `lastUsedHere` from the same ids. The S6
  combinations test compares the page with the created session, for both bases.

## Blocking

None.

## Should fix

**R2-S1. `resolveTodayEdits` can still put one exercise in two slots after a routine edit.**
`packages/domain/src/session/today-edits.ts:411-414`. `swappedAway` is built from every open swap *before*
resolution, so a swap that then resolves `stale` (because the slot's target is `taken`) still counts its slot as
"swapped away". The slot's own exercise is then free for another swap, even though the slot keeps it.
Scenario (probe confirmed): Push A is bench / incline / fly. Ben swaps bench → chest press, then fly → bench (allowed,
because bench was swapped away). Before starting, he edits Push A and puts chest press in the incline slot. Resolve:
`bench → chest press` is `stale` (incline has it), and `fly → bench` is `applied`. The plan is bench, chest press,
bench. That is the S5 failure again: `applyTodayEditsToRoutine` (`:573`) keys `targets` by exercise, so one bench
slot plans with the other's targets and set count. The page and Start still agree, so preview == Start holds.
It's narrow, because it needs a routine edit between today's edits and Start.
Fix: build `swappedAway` from swaps already resolved `applied` (resolve to a fixpoint), or add a final pass that
marks the later swap `stale` when an exercise appears twice in `editedSlots`. Add this case to the S5 domain test.

## Nits

**N1. The S2 screen fix is tested only through the helper.** The new `startFromOverview` test would pass without
the `fresh.cleared` change too: the cleared page differs from the edited one, so the old code already returned
`stale` with that page. What fixes TE-A15 is the screen line `staleStartToast(r.page, …)`, and no test reaches it.
`staleStartToast` is unit-tested as a pure function. Consider a test where `pageToast` runs on the follow-up reload,
to show it doesn't overwrite the toast, or accept this as covered by inspection.

**N2 (r1 N1, open).** `MAX_DRAFT_EDITS = 400` still counts removed edits. Each ↑/↓ and each `clear_swap` adds to
the count, and nothing compacts it.

**N3 (r1 N2, open).** `target-why.ts:314` still renders `Swapped` + `Before start · Bench press`, while spec §5 says
`Swapped before start · Bench press`.

**N4 (r1 N5, noted).** `ensureExercise` still saves a picked catalogue exercise as Ben's row. It now runs after
`swapAllowed`, so a refused pick no longer creates one, which is an improvement.

**N5.** `swapAllowed` resolves the overview a second time on every swap write, and `writeDraft` resolves it again.
That's fine for a single user, but the check could move into `writeDraft`'s `make` callback, which already has the
base slots.

## Spec issues

1. r1 Spec issue 1 (Undo semantics) has been decided in the spec text as "`Undo swap` / `· planned` = back to the
   plan, toast Undo = one step", marked "pending Ben". Ben needs to confirm it, along with r1 Spec issues 3 and 4
   (migration 7 is frozen once released, and the TE4 routing). Those still stand.
2. r1 Spec issue 2 (TE-A17 "exported and deleted with Your data") is still unchanged in the spec.

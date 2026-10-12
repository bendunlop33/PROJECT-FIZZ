VERDICT: CHANGES NEEDED

# Review: Workout gaps (claude/gaps)

Reviewer: independent reviewer agent, 11 Oct 2026.
Scope: `git diff claude/gracious-knuth-joxqpw...claude/gaps` (15 commits, 68 files), checked against
docs/backlog.md §4.1 (the seven workout items and five loose ends), the DX9 backup item, the
2026-10-11 "Backlog defaults accepted" CHANGELOG entry (B3, copy D4, B5), docs/design/active-workout.md
§2.7, §4.4 and §4.8, exercise-library.md §2.5, §4.6 and §7, data-import-export.md DX9/DX9a, and
CLAUDE.md rules 1–10.

## Checks run

- `npm run typecheck`: exit 0.
- `npx eslint .`: exit 0.
- `npx vitest run --testTimeout=120000`: 203 files, 3914 passed, 2 failed, 1 todo. The two failures were
  `packages/catalogue/test/definition.test.ts` (D6 pixel test, 94 s) and
  `packages/persistence/test/backup-perf.test.ts` (S3 queue wait). This branch doesn't touch either file,
  and the machine was running other agents' suites at the same time. Rerun on their own, both pass
  (2 files, 42 tests). I count them as load flakes, not regressions.
- A throwaway probe of `nextTargetsFor` with a distance exercise (written, run, deleted, not committed). It
  returns `insufficient_data` with `8–12 reps` and "Pick a load you can do for 8–12 reps" (see N1).

## Item checklist

| Item | Status | Notes |
|---|---|---|
| 1 Mid-workout swap (B3) | Built, one blocking gap | Only pending sets move. Done and skipped sets stay. Fitted by `snapPlanToGym`; the reducer re-checks achievability, convention and unit. Idempotent (generated IDs aren't in the fingerprint), versioned, Undo through `undo_op`, `Undo swap` in the `⋯` menu. A flagged pick asks first (EL9). Gaps: **B1** (pain, B5/rule 9) and **S1** (unilateral companion). |
| 2 Undo for delete set, skip and corrections (D4) | Built | The alerts are gone. `undo_op` restores from the audit only while each touched set's version still matches the operation's result. The opId is derived (`undo:<target>`), so a double tap is a duplicate. Refusals aren't recorded, so a retry after "stop the timer first" works. Unilateral companions deleted with a set come back with it. Tested at domain and service level. |
| 3 Timed exercises + work timer | Built, partly | Picker unhidden. Start/Stop/at-0 tick fills the draft. Not built (documented in §2.7 "As built"): spoken `Time.`, an alert at 0 while locked, `Auto-save timed sets`. See **S2** and **S3**. |
| 4 Distance sets | Built | `distanceM` across schema, reducer, persistence (migration 10), display, Edit set and the How to route. Repeat drops distance exercises (**S4**). |
| 5 Remove exercise added by mistake | Built | Refused once a set is logged or the row has parts at another gym. Every view, the coach context and the derived title leave it out. Undo works. See N5. |
| 6 Notes | Built | Exercise and set notes, during and after Finish. They never touch values or the set's version, aren't sent to the coach, and go into the backup. |
| 7 Set-type control | Built | Chip row in Edit set, saved in the same `correct_set`, Undo through D4. |
| Loose end: 7-F 10% jump | Fixed | `maxLoadJumpPercent: 10` on the built-in rule, resistance loads only. Tested, including at-cap hold and assisted exclusion. See Spec issue 1 and N3. |
| Loose end: same-gym "Done at more than one gym" | Fixed | `gyms` count on the block. Tested for the same item, another item at the same gym, and two gyms. |
| Loose end: no-equipment 0 + 2.5 kg | Fixed | Exhaustive test across total/each/stack × kg/lb × history shapes. |
| Loose end: Keychain wipe | Fixed | Every key is tried and then read back. A test makes the first key throw. |
| Loose end: two time estimators | Fixed | `estimateRemainingDuration` now calls `estimatePendingWork`. The Finish-by wheel is still waiting on the designer, as the backlog says. |
| Backups: wording + Keep 7/14/30/All | Built | `keep: null` = All. A change applies only at the next automatic backup. Line: `Every workout is kept. Each copy is a full backup of all of them.` See N4. |

## Blocking

### B1. A swap after pain gives the substitute an increased target (rule 9, accepted B5, exercise-library §7 check 13)

`apps/mobile/src/services/workout-services.ts:1928` and `:1935`; `packages/domain/src/session/snap.ts:317`;
`packages/domain/src/session/substitutes.ts:96-115`.

The substitute's plan comes from `substituteTargets(slot, exercise, history, sctx)`, which calls
`nextTargetsFor` with `exerciseId` = the **substitute**. `painStatusFor` and `painFlagCovering` match on
`exerciseId` only, so a flag on the original never applies. The fit then holds loads only when
`painFlagged.has(slot.exercise.id)`, and that is the substitute's ID too. Nothing carries the original's
flag across the swap.

Failure scenario: Ben logs bench set 1 and ticks `Pain` (that sets a flag on Bench press). Mid-workout
swapping is mainly used for exactly this, so he then swaps to Dumbbell bench press, which he last did at
30 kg each × 10 with RPE 8. The new sets show `Target 32.5 kg each × 6–10` (`increase_load`) and apply at
once. Rule 9 says pain "stops progression for that movement". Ben accepted B5 on 11 Oct ("After pain on one
exercise and a swap to a similar one, block the similar one from going up today: Yes, today only"), and
exercise-library §7 check 13 requires the same. No test covers swapping from a flagged exercise.

Fix: in `swapExercise` (and `swapCandidates`, so the sheet shows the same target), when the original row's
exercise has an active pain flag or a done set on the row carries the `pain` exclusion, plan the
substitute as held for today. For example, pass `sessionPain: { active: true, … }` for that call, or add
the substitute's ID to `painFlagged` so the fit holds loads. Say so with the existing pain wording (`⚠ Pain
flag: no increases`). Add domain and app tests: flag Bench, swap to DB bench with history that would
progress, and expect no load or reps increase. Without a flag, the same history should still progress.

## Should fix

### S1. Swapping a half-logged unilateral pair turns the other side into an extra set of the substitute

`packages/domain/src/session/reducer.ts:1495`, `:1553`; `packages/domain/src/session/mid-swap.ts:25-34`, `:64`.

`midSwapSlot` and `handleSwapExercise` take **every** pending set, including the pending other-side
companion that `makeCompanion` (`reducer.ts:478`) creates after a Left-only log (`pairedWithSetId` set).
The swap deletes the companion and creates a full new set (`side: 'both'`/`null`, `pairedWithSetId: null`)
on the substitute. It also counts the companion as a working set in `workingSets`.

Failure scenario: Bulgarian split squat, 3 sets. Ben logs set 2 Left only, then swaps to Reverse lunge.
The lunge gets 2 sets (Right-of-set-2 plus set 3) instead of 1. The split squat's set 2 is left
permanently half-done, which the progression treats as unpairable.

Gym switch handles this case ("a half-logged unilateral pair's other side … are left alone, and named",
gym-switch tests). Do the same here: leave companions on the original row (or refuse the swap until the
pair is finished), exclude them from `midSwapSlot`, and add a test.

### S2. A timed set can't be logged without running the work timer

`packages/domain/src/session/active-view.ts:718`.

In the `idle` state the primary is always `Start 0:45`, whatever time is already in the field. If Ben timed
the plank on the gym clock, or forgot to tap Start, he has two options. He can wait out the full countdown.
Or he can tap Start then Stop, which writes the elapsed ~0 s over the typed time (`handleStopWork`), so he
has to re-enter it before `Log`. That breaks brief §12's fast logging for a common case. The tests only
cover Start → Stop → Log.

Fix: when the draft has a time Ben typed (`draftSource` `edited`), offer `Log 0:45` as the primary with
`Start` as a secondary. Or keep `Start` primary and add a `Log` text button. Add a test.

### S3. No cue at 0 when the screen has locked during a timed set

`apps/mobile/src/screens/workout/WorkoutScreen.tsx` (work-timer effect after `:454`).

The haptic fires only in the foreground. The app doesn't keep the screen awake, and iPhone auto-lock is
often 30 s, so during a 45–60 s plank or hang the phone is usually locked by 0. Nothing tells Ben the time
is up. §2.7 "As built" records this as not built. The rest alert, by contrast, is a first-milestone
reliability requirement in CLAUDE.md. Schedule the existing local-notification layer for the work
deadline, or keep the screen awake while a work timer runs. Until one of those exists, this needs Ben's
explicit OK as a known gap. `Auto-save timed sets` (in the backlog row) isn't built either. That's fine
given the narrower scope, but it should be recorded in the backlog.

### S4. Repeat silently drops distance exercises

`packages/domain/src/session/repeat.ts:180` (and the `swap` branch above it).

`doneWithReps` keeps only sets with `reps` or `durationS`, and `SetTemplate` has no distance field. So
`Repeat` of a workout with a sled push leaves the sled push out, with no `notCopied` line. Either copy
distance targets (a `targetDistanceM` on the template, which is the workout-library branch's area, so
coordinate) or list it under "not copied". Add a test.

### S5. Migrations 8 and 9 are empty placeholders, with nothing stopping a build that contains them

`packages/persistence/src/migrations.ts:36-43`.

The MERGE NOTE is clear. But `assertWellFormed` accepts the placeholders, and nothing in CI or tests
refuses to build an `.ipa` that contains them. Suppose this branch merges before delete-workouts or
workout-library, and any build reaches Ben's phone. His database records `user_version = 10` without the
real 8 and 9, and those migrations never run. The result is missing delete-workouts triggers and tables,
with no error. Add a guard that fails the release workflow (or a test tagged for release) while any
migration's SQL is empty. Or merge this branch only after 8 and 9 have landed, and rebase.

## Nits

- **N1.** `packages/domain/src/progression.ts:695`: `calculateNextTargets` returns `unsupported` for
  `duration` but not for `distance`. A distance exercise gets `insufficient_data` with `8–12 reps`
  ("Pick a load you can do for 8–12 reps", from the probe). Today the Summary hides `insufficient_data`,
  and the other callers filter on `measurement === 'reps'`, so nothing shows. One new caller would surface
  it, though. Treat `distance` like `duration`.
- **N2.** `packages/coach/src/context.ts:133`: `actualOf` drops `durationS` and `distanceM`, so the coach
  sees a sled push as `40 kg × —`. Duration had this gap already. Distance makes it wider.
- **N3.** `packages/domain/src/default-rule.ts:83, 99`: the built-in rule changed behaviour but kept
  `version: 1`. Targets recorded before and after this change cite the same rule version for different
  logic. Bump it (rule 5, versioned writes; `Why?` provenance).
- **N4.** `apps/mobile/src/screens/data/DataBackupScreen.tsx:140`: the `setKeep` result is ignored. If the
  manifest isn't writable, the choice silently doesn't stick. Show the existing short failure line.
- **N5.** `apps/mobile/src/screens/workout/WorkoutScreen.tsx:722`, `active-view.ts:636`:
  `Remove exercise` is offered for a planned routine exercise too, not only one that was added. Removing
  it hides it from the Summary, where `Skip` would have shown it as skipped. The spec (§4.6) says "added
  by mistake". Consider offering it only for rows added in this workout, or confirm with the designer.
- **N6.** `reducer.ts:1539, 1599` and `restoreAudited` (`:1625`): delete, remove and swap clear a pending
  set's `draft`, and Undo doesn't bring it back. A typed but unlogged draft is lost after Delete → Undo.
- **N7.** `EditSetScreen.tsx:97`: if the correction saves but the note write then fails, the screen
  returns before handing over the correction's `Set N updated` [Undo] toast. The correction keeps its Undo
  only until the screen is left.
- **N8.** `WorkoutScreen.tsx:555`: `refusalText` was inserted between `run`'s doc comment and `run`, so
  the comment "Run one command…" now documents the wrong function.

## Spec issues

1. **7-F's ~10% limit permanently stops load progression on light loads.** With 2–2.5 kg dumbbell or stack
   steps, every load under about 20–25 kg has its next step over 10%. The rule then progresses reps to the
   cap and "holds" forever. Example: 10 kg lateral raises stuck at 15 reps. The updated gym-switch test
   shows the same at 20 kg dumbbell press (target becomes `20 kg each × 12`). The code does what the
   playbook says. The playbook should say what happens at the cap: for example, take the smallest
   achievable jump once reps reach the cap and reset to the range bottom. That's Ben's or the
   training-researcher's call.
2. **B5 is accepted but only exercise-library §7 check 13 states it.** active-workout §2.14/§8.3 and
   exercise-library §2.5 "As built" don't mention it. Add one line to the swap section so the next build
   doesn't miss it (B1).
3. The backlog row for timed exercises includes `Auto-save timed sets`, but this branch's scope left it
   out. The backlog should keep it as a separate open item.

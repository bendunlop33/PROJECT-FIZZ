# Review: cardio with a timer and distance (branch `claude/cardio-19oct`, 5217386..206672e)

**Verdict: CHANGES NEEDED**

Reviewer: independent reviewer agent, 19 Oct 2026. Nothing here has been checked on a real iPhone.

## Checks run

- `npm run typecheck`: passes. `npm run lint`: passes.
- Targeted: domain/persistence/app `cardio.test.ts`, `coach-add.test.ts`, `coach-draft.test.ts`: 5 files, 78 tests pass.
- Full suite (`--maxWorkers=2`): 345 files, 6,898 passed, 1 todo. `check:migrations`: 1 to 20 OK.
- I ran a throwaway reducer probe, deleted afterwards, for Stop → Start and for ✓ at 0 s. Results are quoted in S4 and N1.

What works: a count-up timer read from the stored start that survives a force-close; ✓ logs the timer's time with the distance typed in; retried logs are duplicates; pace is computed only from real numbers; no calories; cardio is kept out of e1RM, volume, records and muscle counts; the built-in rule never progresses cardio; the migration leaves set values alone and old backups restore as cardio; there are no new entitlements and no secrets.

## Blocking

### B1. "Next time repeats last time's time and distance" only works for Start next session from an ad-hoc workout
- `apps/mobile/src/services/workout-services.ts:1370`: `builtInNextTargetsOf` skips every `measurement !== 'reps'`, so `routineStart` (used by Up next and saved workouts) falls back to the routine's template.
- `apps/mobile/src/services/workout-services.ts:1300`: `planFor` returns `null` for non-reps, so adding a rower from the picker gives empty sets with no target.
- `packages/domain/src/progression.ts:997-1000` returns `unsupported`, and `plannedSetsFromTargets` (`next-target.ts`) drops that.
- **Failure:** Ben saves "Push + row" with the default 10:00 row, rows 20:00 · 4,800 m, then starts Push + row from Today next week. The target shows `10:00`, not `20:00 · 4,800 m`. Adding the rower to any later workout from the picker shows no target at all. Only `startWorkoutFromSession` (`repeat.ts`, the `nextOf` path in the tests) copies the values. The spec ("Targets: next time shows last time's time and distance (repeat)"), the CHANGELOG entry and the developer summary all promise this behaviour for every path.
- **Fix:** add a pure domain function `cardioRepeatTargets(history)` that returns the last comparable session's completed cardio sets as planned `{durationS, distanceM}` (source `built_in_rule`, with provenance "last time"). Use it in `builtInNextTargetsOf` and in `planFor` when `measurement === 'cardio'`, leaving the reps path unchanged. Test it through a routine start, through Up next and through a picker add after a logged row.

## Should fix

### S1. The Today overview and Library Add sheets clamp a cardio time to 10:00
- `apps/mobile/src/workout/overview-edits.ts:440`: `REPS_LIMITS.maxWorkS = 600` with 5 s steps.
- `packages/domain/src/session/overview.ts:1148`: `timed: ex.measurement !== 'reps'` sends cardio to the seconds sheet.
- `apps/mobile/src/workout/exercise-info-view.ts:41-54`: the Library Add sheet's `Work time` row uses the same seconds draft.
- **Failure:** on the pre-start overview, Ben sets the row to 20 minutes. The sheet stops at 10:00 in 5 s steps, has no distance field, and the stored target is silently clamped to 10:00.
- **Fix:** give these sheets a cardio variant (minutes plus distance, capped at `CARDIO_TIMER_CAP_S` or `maxCardioS`), or route cardio rows to `PlannedSetEdit`, which already handles cardio.

### S2. The picker adds three cardio sets unless the Cardio chip is on
- `apps/mobile/src/screens/workout/ExercisePickerScreen.tsx:89` passes `shape: { workingSets: sets }`. `sets` is `SET_BAR.start` unless the chip was tapped (line 167), and `shapeAddPlan` (`add-shape.ts:48`) uses it as given.
- **Failure:** Ben searches "row" and taps Rowing machine. He gets three empty row sets. The "one 10-minute set" default applies only in the routine editor, the coach paths and `addedSlotShape`.
- **Fix:** when the chosen exercise is cardio and Ben hasn't touched the Sets bar, send `workingSets: 1`. Better still, set the bar from `defaultSlotShape(exercise)` when an exercise is chosen. Add an app test for adding a rower without the chip.

### S3. A coach add asking only for a distance gets a 10:00 time it never asked for
- `packages/domain/src/session/coach-add.ts:155` and `packages/domain/src/session/coach-draft.ts:438` both do `args.workSeconds ?? CARDIO_DEFAULT_S`, even when `distanceMetres` is set.
- **Failure:** "Add a 5k row" becomes `Coach target 10:00 · 5,000 m`, which implies a 2:00 /500 m pace target Ben didn't ask for (rules 3 and 6: the time has no basis).
- **Fix:** for cardio with `distanceMetres != null && workSeconds == null`, set `durationS = null`. `SetTemplateSchema` and `DraftSetTemplateSchema` must then allow a distance-only cardio template; the draft refine currently requires reps xor duration.
- **Related:**
  - `packages/coach/src/render.ts:310-313` (`addedPhrase`) and the `ActionDetail` in `packages/coach/src/add-exercise.ts:86-98` have no distance, so the confirmation card reads `Added Rowing machine: 1 × 10:00.` with the distance Ben asked for missing.
  - `packages/coach/src/claims.ts:1100,1110` only whitelists raw seconds, so a coach reply saying "20 minutes" or "5,000 m" is hidden as unchecked.

### S4. ✓ seconds after Start logs a completed `0:00` set
- `packages/domain/src/cardio.ts:54` (`cardioHasValue`) treats `durationS === 0` as a value. `reducer.ts:424` replaces the time with the timer's elapsed time.
- **Probe:** Start at t=100, ✓ at t=100 with no distance gives `status: completed, actual.durationS: 0`, no distance.
- **Failure:** a mistap on the small ✓ next to the big Stop/Start writes a completed 0:00 row into history (and into Progress `Total time` session counts). Ben then has to delete it.
- **Fix:** require `durationS > 0 || distanceM > 0` for cardio in both `validateValues` and `missingFor`. Test that ✓ at 0 s is refused while the timer keeps running.

### S5. Time is typed as decimal minutes but the machines show mm:ss
- `packages/domain/src/cardio.ts:94-104`; `WorkoutTable.tsx:1001,1204`; `WorkoutScreen.tsx`, `EditSetScreen.tsx` and `PlannedSetEdit.tsx` all use `MIN` with decimals.
- **Failure:** the rower shows `20:34` and Ben types `20.34`. The app stores 20:20 (1,220 s) instead of 1,234 s, with no warning. That misstates the set and the pace (rule 6). After Stop, a 20:34 time also shows as `20.57`, which matches nothing on the machine.
- **Fix:** use an `mm:ss` (or `h:mm:ss`) time field for cardio, or minutes and seconds as two fields. Keep the stored value in seconds. If decimal minutes stays as a PM decision, at least show the parsed `20:20` next to the field. Add this to the CHANGELOG questions for Ben.

### S6. Stop can't be undone and is the large button while rowing
- `packages/domain/src/session/active-view.ts:542` and `:917`: after Stop the timer is `ended` and the primary becomes `Log …`. Nothing offers Start or Resume.
- The reducer allows a second `start_work_interval`, which restarts at 0. Probe: Stop at 10:00, Start, 10 more minutes, ✓ logs `durationS: 600`, and the first segment is lost.
- **Failure:** during a row the big primary button is `Stop` and ✓ is a text button. Ben taps Stop for water and can't resume the count. If a later build exposes Start, the first segment is silently dropped.
- **Fix:** either make Stop resumable for cardio (accumulate into `pausedMs`/elapsed rather than ending), or refuse `start_work_interval` on a cardio set whose draft already holds a timer time. Test both.

### S7. Tests miss the risky paths
There are no tests for any of the following:
- a routine start, Up next or a picker add after a logged row (B1)
- the overview or Library sheet with cardio (S1)
- a picker add without the chip (S2)
- a distance-only coach add (S3)
- ✓ at 0 s (S4)
- Undo of a cardio log while or after the timer ran
- the migration running while a session is in progress with a running air-bike timer (its `durationS` stays at the old planned value, e.g. 600 s, so it auto-completes at 10:00 under cardio rules)
- the 4 h auto-complete (`reducer.ts:385`, which emits `WorkIntervalEnded` `completed`: check that it plays no in-app "Time" cue)

Add these alongside the fixes.

## Nits

- **N1.** The migration relabels completed sessions' `session_exercises.measurement` without bumping `sessions.version` or writing an audit row (`0020-cardio.ts:34-35`). Values are untouched and it's listed as pending Ben (Q1), but if Ben says no, there's no record of which rows changed. Consider an audit or provenance note.
- **N2.** `packages/schemas/src/workout-draft.ts:186` widens `durationS` to 7,200 s for every draft set, not just cardio. Code clamps timed sets, but the schema no longer does.
- **N3.** `packages/schemas/src/routine.ts:40` now accepts a distance-only template for any measurement. Limit it to cardio, or document why.
- **N4.** `packages/domain/src/session/coach-add.ts:182` copies the coach's `targetRpe` onto cardio planned sets, so the table can show `@ 8` on a row. Builds already drop it (`coach-draft.ts`), so do the same here.
- **N5.** `packages/domain/src/progress/exercise.ts:64`: the series ID changes from `…|distance` to `…|cardio` for the four machines, so a remembered Progress chart choice for the rower falls back to the default once.
- **N6.** `packages/domain/src/exercise-browse.ts:184-185`: the Library's measurement tag has no cardio case.
- **N7.** The ExercisePicker chip resets the Sets bar to `SET_BAR.start` when turned off, discarding Ben's own count.
- **N8.** Distance is metres only. That's fine for Ben's UK machines, but say so in the CHANGELOG.

## Spec issues

- **SP1.** No design doc covers this feature (`docs/design/` has nothing on cardio). The slice went straight from the PM's spec to the build, so the table/focus layout, the Stop-versus-✓ priority (S6) and the time-entry format (S5) were never designed. Before the device test, add a short cardio section to the active-workout design spec covering the timer states, time entry and the overview sheet.
- **SP2.** The spec asks for the new machines "with cues/safety brief like others", but the existing cardio entries (rower, ski erg, treadmill, air bike) are `tier: basic` with no cues either. "Like others" is satisfied literally but not in intent. Ben should decide whether to send them to `exercise-researcher` (developer's Q5).
- **SP3.** The spec says "next time shows last time's time and distance", but for routines it doesn't say whether the template (Ben's plan) or last time's actuals should win. B1 assumes the actuals win, matching "repeat". Ben should confirm.
- **SP4.** Migration numbering: this branch and `claude/plans-19oct` may both take 20. Make renumbering a merge gate, and re-run `check:migrations` and the old-backup restore test after renumbering.

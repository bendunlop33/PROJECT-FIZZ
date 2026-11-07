# Review: Library tab, Exercise detail and Sets when adding (claude/library-browse)

Reviewer: independent reviewer agent, 12 Oct 2026
Diff: `claude/gracious-knuth-joxqpw...claude/library-browse` (7 commits, 52 files)
Against: Ben on build 126, (1) "view exercises etc even when not in workout mode" and (2) "when creating a workout [I] should be able to select the number of sets per exercise". Also exercise-library.md §9–§10 (EL-B1 to EL-B24), routines.md WL11 / WL-A17 / WL-A18, overview-today-edits.md TE-B15, design-system §9.88–9.91, and CLAUDE.md rules 1–10.

## Verdict: **CHANGES NEEDED**

Most of the work is solid. The search matcher (aliases, one typo per word of 5+ letters, ranking) is pure and well tested. The set-shape domain functions are correct and keep warm-ups separate. The picker, the overview edit-mode add sheet and the editor add sheet all send a `Sets` count. Exercise detail keeps Coaching knowledge and Your data in separate labelled sections, and its numbers come from Progress's own series. Saved-workout adds are versioned, idempotent and undoable.

Two problems block this. First, moving the Workouts list into the Library removes the only way to create a new workout once Ben has at least one (B1). Second, one creation path still has no sets control: `Save to Workouts` (B2).

### Checks run (in /home/user/wt-browse)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run` (default suite) | 264 files, 4955 passed, 1 todo, 0 failed |

---

## Blocking

### B1. Library › Workouts has no `New workout` once a workout exists, so Ben can't create one

- `apps/mobile/src/screens/library/LibraryScreen.tsx:59` renders `WorkoutsList` with no `＋`. The tab stack sets `headerShown: false` (`AppNavigator.tsx` `LibraryHome`), and the exported `NewWorkoutButton` (`WorkoutsScreen.tsx:51`) is only used by the old root `Workouts` route.
- `WorkoutsList` only offers `New workout` in the empty state (`WorkoutsScreen.tsx:288`).
- The root `Workouts` route (the one with the `＋` header) is now unreachable. Today's `Workouts` link was removed (`TodayScreen.tsx:683`), and both pickers' `Edit workouts` now go to `openLibrary('workouts')`. `replaceWithWorkouts` has no callers.
- **Failure scenario:** Ben has Push A saved, opens Library › Workouts to "create a workout" (his request 2), and finds no `＋` or `New workout`. The only remaining route to a new workout is going through some exercise's detail → `Add to a workout` → `New workout`, which nobody would find. On build 125 this took one tap from Today. This is a regression on the exact flow Ben asked to improve.
- **Fix:** give `LibraryScreen` the spec'd header (§9.3: `Library ＋ ⋯`). On the Workouts segment, `＋` opens `New workout` (and `New with coach` once the coach builder is merged, routines.md §A2.1). On Exercises, it opens `New exercise`. Add a test that Library › Workouts with ≥ 1 workout offers `New workout`. Then either remove the root `Workouts` route or keep it reachable on purpose.

### B2. `Save to Workouts` has no sets control (EL-B23, WL-A18, §10.4)

- `apps/mobile/src/screens/routines/SaveWorkoutSheet.tsx:35,100` is unchanged. The summary line `5 exercises · 15 sets` has no `Edit ›`, and nothing opens the editor on the unsaved copy.
- §10.4 lists `Save to Workouts` (Summary, past workout, overview `⋯`, `FROM HISTORY`, Repeat) and coach drafts as creation paths. Their sets control is the Save sheet's `Edit ›`. The brief for this task says every creation path must offer the control.
- **Failure scenario:** Ben finishes an ad-hoc workout, taps `Save to Workouts`, and wants 4 sets of curls rather than the 2 he did. He has to save first, then find the workout in Library › Workouts, open `⋯ › Edit workout` and change the count. That is the "can't change it" complaint again on a different screen. The `library-tab.test.ts` source check "every creation path sends the Sets count" doesn't cover this path, so the gap went unnoticed.
- **Fix:** build §A2.5's `Edit ›`. Open `WorkoutEditor` with the unsaved copy as `draft` (the param already exists), and make the editor's `Save` create the workout with the Save sheet's opId (one write, one toast Undo). `Cancel` returns to the sheet unchanged. Add EL-B23 / WL-A18 tests: change a count, then Save creates one workout with that count, and Cancel writes nothing.

---

## Should fix

### S1. A distance exercise added to a saved workout from the Library is saved as reps

- `library-service.ts:358` calls `addSlot(..., { measurement: exercise.measurement }, ...)`, and `routine-editor.ts:33` `template()` gives every non-duration measurement `targetReps 8–10`. `ExerciseInfoScreen.tsx:394` only hides the Reps row for distance; it still offers every saved workout as a destination.
- **Failure scenario:** Sled push (catalogue, `measurement: 'distance'`) → `Add to a workout` → `Legs A` saves 3 × `Auto × 8–10` on a distance exercise. routines.md (review workout-library-merge S1, `isDistanceSet`) says a distance exercise is "never saved as reps". The workout's Start then plans reps targets for a sled push.
- **Fix:** for `measurement === 'distance'`, disable the `YOUR WORKOUTS` and `New workout` rows (or leave them out). Keep `NOW`, since sessions can log distance. Test it. See also Spec issue 1.

### S2. Spec'd parts of Library and detail are missing

None of these is core to Ben's two requests, but each is in §9.3–§9.8 and several are acceptance checks:
- No `＋ New exercise` and no `Create "<query>" as a new exercise` row. EL-B3's `landmine twst` shows only `No match for …`. `LIBRARY_BROWSE_COPY` has neither string.
- `Alternatives at Main Gym ›` isn't rendered. `ExerciseInfoView.knowledge.alternativesLabel` is computed (`exercise-browse.ts`) but never used in `ExerciseInfoScreen.tsx` (between lines 153 and 155).
- Detail `⋯` (Other names, Default rest, Notes, custom Edit), the `Notes` row and long-press on browse rows are absent.
- **Fix:** build them, or record in exercise-library.md which ones are deferred (as §8.2 does for "Specified, not built") so the acceptance checks match what shipped.

### S3. `SetShapeControl` never stacks at large text (EL-B24, design-system §9.88)

- `set-shape.tsx:55,124` support `stacked`, but no caller passes it (the editor card, Add sheet and pick-sheet bars all omit it).
- **Failure scenario:** at AX3 on a 375pt phone, `Warm-ups` / `Target RPE` and the two 44pt circles plus the value share one row inside a padded card, so the label wraps letter by letter or the value is cut off. EL-B24 requires these to be usable at AX3.
- **Fix:** pass `stacked` when the content size category is AX1 or above (the theme's Dynamic Type hook), and add a render check.

### S4. The branch is 46 commits behind its base, with 3 merge conflicts and new creation paths not covered

- `git merge-tree` against `claude/gracious-knuth-joxqpw` conflicts in `apps/mobile/src/navigation/types.ts`, `packages/domain/src/session/today-edits.ts` and `docs/design/workout-builder.md`.
- The base now has the coach workout builder (drafts with `Save to Workouts`) and the coach's `add_exercise_today`. Neither path has been checked against §10.4. Coach drafts depend on B2's `Edit ›`.
- **Fix:** rebase or merge, resolve the conflicts (`today-edits.ts`'s `add` body now has to carry both `workingSets` and the coach add's fields), re-run the suite, and confirm the §10.4 table against the merged tree.

---

## Nits

- **N1.** Picker opIds are keyed on the count (`ExercisePickerScreen.tsx:84`, also `WorkoutOverviewScreen.tsx` `add:<id>:<sets>`). If an add fails ambiguously (the write landed but the response was lost) and Ben then changes the count and taps again, a new opId produces a second row. The session reducer has no "already in the workout" guard on this path, unlike `library.addToWorkout`. Key the opId on exercise and equipment only, as before, and treat the count as part of that one op's payload.
- **N2.** `library.addToWorkout` session path takes no `expectedVersion` (§9.10's contract has one). It's append-only and guarded by `already`, so this is low risk, but the contract and the code disagree. Either add the version or update §9.10.
- **N3.** `Also called …` (`ExerciseInfoScreen.tsx:124`) mixes catalogue aliases (Coaching knowledge) with Ben's own FitNotes names (Your data) in the header above both `DomainLabel`s (rule 10). Using them together for search is fine. For display, show catalogue aliases only, or put his names under Your data.
- **N4.** `AddToWorkoutSheet` shows no error when `destinations()` returns null: the list is just empty under `YOUR WORKOUTS`. Show `Couldn't open your exercise list.` [Try again] as §9.6 does for the database-error state.
- **N5.** A Library add to the running workout always sends `warmups: 0`, which drops any warm-ups the exercise's own history plan had. The picker path keeps them. This matches §9.5/§10.1 as written, but the two add paths now behave differently for the same exercise. Consider leaving warm-ups out unless Ben touched the stepper.
- **N6.** Every keystroke in Library search re-reads exercises, aliases, pain flags, gym equipment and history. It works and has no race (`useScreenData` cancels stale loads), but a short debounce or caching the non-query inputs would keep it smooth with a large FitNotes import.
- **N7.** Progress › `Exercise info ›` opens detail on the default series even when Progress was showing another series. `Progress and records ›` from the Library likewise passes no `seriesId`. Pass the series through for EL-B8's "same series".
- **N8.** `actions.ts` `replaceWithWorkouts` and the root `Workouts` route are dead code after this change (see B1).

## Rule-by-rule

| Rule | Status |
|---|---|
| 1 Offline / honest AI | OK. Library, detail, Add and Undo are local only. A source test confirms no coach calls. |
| 2 Completed sets / proposals | OK. `shapeAddPlan` only shapes the new exercise's pending sets. Undo goes through `remove_exercise`, which refuses once a set is logged. |
| 3 Deterministic targets | OK. The UI computes no progression. Template `targetRpe` reaches planned sets at Start (`create.ts:341`). |
| 4 Achievable loads | OK. Added loads are `Auto` and copied loads keep their unit and convention (tested for per-hand, lb, assisted). |
| 5 Idempotent and versioned | Saved-workout add: OK (opId-derived IDs, `expectedVersion`, `update_routine` record, stale refused, tested). Session add: see N1, N2. |
| 6 No invented data | OK. `Last` and `Best set` are actuals from one named series. `Est. 1RM` comes from Progress with `≈`. |
| 7 Credentials | No change. |
| 8 Imports as data | OK. FitNotes names are only used as search strings. |
| 9 Pain | OK. `May hurt` is tagged, never hidden, and asked before adding. |
| 10 Your data / Coaching knowledge | Mostly OK (two `DomainLabel` sections). See N3. |
| Minimal copy | OK. Values and actions only. |
| Accessibility | Steppers and rows ≥ 44/52pt, adjustable VoiceOver element, tabular values. See S3 for AX3. |

## Creation paths vs the sets control (§10.4)

| Path | Sets control | Status |
|---|---|---|
| Library › Workouts › New workout | editor card + add-sheet bar | **Unreachable with ≥ 1 workout (B1)** |
| Edit workout / Duplicate (editor) | `SetShapeControl` per card | OK |
| Editor `Replace` | keeps the slot's sets | OK |
| Overview Edit › Add exercise | sheet bar, then row stepper | OK (TE-B15 tested) |
| Empty workout / mid-workout Add exercise | picker `SetCountBar` | OK (EL-B21/22 tested) |
| Library detail › Add to a workout | sheet `SetShapeControl` | OK (distance: S1) |
| Save to Workouts (Summary, history, Repeat, overview `⋯`) | Save sheet `Edit ›` | **Missing (B2)** |
| Coach builder drafts / coach add today | via Save `Edit ›` | Not in this branch (S4) |

## Spec issues

1. **EL-B13 / §9.6 "Can't log distance yet" is out of date.** Distance sets became loggable on 2026-10-11 (`PICKER_MEASUREMENTS` includes `distance`), so Sled push can go into a running workout. What still can't hold distance is a saved workout's set template. The spec should say: distance exercises can be added to `NOW` but not to saved or new workouts (`Can't save distance in a workout yet.` on those rows), until set templates get a distance target. S1 depends on this.
2. **EL10–EL14 are marked "for Ben to confirm" but are built.** They are: the fourth tab, Today's `Workouts` link retiring, the still poster, the two-section detail and add-with-Undo. That is acceptable for a test build, but the PM should get Ben's confirmation on the next build and record it in `docs/brief/CHANGELOG.md`. If Ben keeps three tabs, the §9.1 fallback (an `Exercises ›` row on Progress and 🔍 on Workouts) needs B1's `New workout` fix too.
3. **§10.4 relies on an unbuilt Save-sheet `Edit ›` for coach drafts.** workout-builder.md (revision 2026-10-12) sends Ben to it. Until B2 is built, the coach-draft row in §10.4 has no sets control at all. Build B2 before or together with the coach-builder merge.

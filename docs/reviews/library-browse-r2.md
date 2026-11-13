# Review r2: Library tab, Exercise detail and Sets when adding (claude/library-browse)

Reviewer: independent reviewer agent, 12 Oct 2026
Diff: `claude/gracious-knuth-joxqpw...claude/library-browse`. Round 2 covers the fix commits `8b61e68` (merge of the base), `1f19f34` (B1), `e272807` (B2), `7574ec8` (S1), `f9b2270` (S3) and `885add9` (docs: S2, S4, spec issue 1). I also re-checked every creation path against exercise-library.md §10.4.
Against: Ben on build 126, (1) "view exercises etc even when not in workout mode" and (2) "when creating a workout [I] should be able to select the number of sets per exercise". Also exercise-library.md §9–§10 (EL-B1 to EL-B24, §9.12), routines.md §A2.5 / WL-A18, overview-today-edits.md TE-B15, design-system §9.88, and CLAUDE.md rules 1–10.

## Verdict: **PASS**

Both blocking findings from round 1 are fixed and tested.

- **B1:** Library has a header `＋` that opens `New workout` on the Workouts segment, and the dead root `Workouts` route is gone.
- **B2:** `Save to Workouts` has `Edit ›`. It opens the editor on the unsaved copy, and the editor's `Save` is the sheet's own save: same opId, one write, one Undo.

Every creation path now offers `Sets [−] n [+]`. The editor shows a `SetShapeControl` on every card, which answers Ben's actual complaint about that screen.

One should-fix remains. The S1 distance guard only covers the Library add sheet, so the workout editor can still save a distance exercise as reps (S1 below). This was already true on the base branch and it doesn't block Ben's two requests, but it is the same rule the round 1 fix was meant to enforce.

### Checks run (in /home/user/wt-browse, at 885add9)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run` (default suite) | 275 files, 5235 passed, 1 todo, 0 failed |

## Round 1 findings

| # | Status | Notes |
|---|---|---|
| B1 No `New workout` with ≥ 1 workout | **Fixed** | `LibraryScreen.tsx:43-49`: `NewWorkoutButton from="Library"` on the Workouts segment. The root `Workouts` route and `replaceWithWorkouts` are removed, and no navigation to `'Workouts'` is left. |
| B2 `Save to Workouts` has no sets control | **Fixed** | `SaveWorkoutSheet.tsx:123-137, 211-224`, `save-edit-handoff.ts`, `WorkoutEditorScreen.tsx:122-143, 215-231`, `workout-services.ts` `saveFrom({ edit })`, domain `withSaveEdit`. All five `Save to Workouts` hosts (Summary, PastWorkouts, Workouts `FROM HISTORY`, overview `⋯` including coach drafts, Repeat) go through `useSaveToWorkouts`, so all of them get `Edit ›`. Tests cover a changed count, an opId retry plus the sheet's own Save being one workout, Undo, the coach draft link and RPE kept, and an invalid edit refused. |
| S1 Distance from the Library saved as reps | **Partly fixed** | The Library add sheet and the service are fixed and tested. The editor path is still open; see S1 below. |
| S2 Spec'd Library parts missing | **Resolved by spec** | §9.12 now lists what is deferred and which acceptance checks it affects. |
| S3 No stacking at AX sizes | **Fixed** | `set-shape.tsx`: `useStacked` uses `fontScale >= AX_FONT_SCALE` for both `SetShapeControl` and `SetCountBar`. Unit-tested. |
| S4 Behind base, conflicts | **Fixed** | Merged at `8b61e68`. The coach's `add_exercise_today` is recorded in §10.4. The base has since gained 19 commits; see N3. |
| N1 opId keyed on the count | Open | See N1 below. |
| N2–N7 | Open, unchanged | Still nits. Not repeated here. |
| N8 Dead `Workouts` route | **Fixed** | Removed with B1. |

---

## Blocking

None.

---

## Should fix

### S1. The workout editor can still add a distance exercise and save it as reps

- `apps/mobile/src/services/workout-services.ts:3013-3024`: `routines.searchExercises` has no measurement filter, so its results include Sled push, Farmer's carry, Ski erg, Rowing erg, Treadmill run, Sandbag lunge and the other catalogue entries measured in distance.
- `WorkoutEditorScreen.tsx:571` adds the pick with `{ ...x.defaultShape, workingSets: sets }`. `defaultSlotShape` (`packages/domain/src/session/routine-editor.ts:100-101`) only special-cases `duration`, so a distance exercise gets `reps = builtInRepRange(...)`.
- `routineIssues` (`packages/domain/src/session/library.ts:50`) doesn't refuse a distance slot.
- **Failure scenario 1:** Ben opens Library › Workouts `＋` › `New workout` › `Add exercise` and picks Farmer's carry with `Sets 3`. `Save` stores 3 × 8–10 reps on a distance exercise. Its next Start plans reps targets for a carry.
- **Failure scenario 2:** the new B2 path has the same gap. `Save to Workouts` leaves distance sets out (`Not copied: …`), but `Edit ›` → `Add exercise` → Sled push lets one back in as reps.
- **Why it matters:** this contradicts EL-B13 as revised in this branch ("nothing is saved as reps") and the routines.md rule that distance is never saved as reps. The behaviour was already in the base, but the round 1 fix only closed it on the Library sheet.
- **Fix:**
  - Enforce it in the domain or the service, not only in the UI. Make `routineIssues` refuse a slot whose exercise is distance (it would need the measurement), or have `routines.create` / `update` / `saveFrom` refuse it with `Can't save distance yet`.
  - In `AddExerciseSheet`, either drop distance exercises from the results or show them disabled with `Can't save distance yet`, matching the Library sheet.
  - Add a test: the editor search for "carry" either doesn't offer Farmer's carry or shows it disabled, and `routines.create` / `saveFrom({ edit })` with a distance slot writes nothing.

---

## Nits

- **N1.** (Still open from round 1.) Both `ExercisePickerScreen.tsx:84` and `WorkoutOverviewScreen.tsx:1079` (`add:<id>:<sets>`) include the set count in the opId key.
  - **Failure scenario:** an add whose response is lost, followed by a change to `Sets` and a retry, gets a new opId and adds a second row of the same exercise.
  - **Fix:** key the opId on exercise and equipment only.
- **N2.** `REOPEN_AFTER_EDITOR_MS = 450` (`SaveWorkoutSheet.tsx:163`) re-shows the Save sheet on a fixed timer after the editor closes.
  - **Risk:** on a slow device, or with Reduce Motion's fade, the sheet can try to present before the editor modal has finished dismissing. On iOS that fails silently and leaves Ben on the host with no sheet. The code comment already flags it for a real-device check.
  - **Fix:** if the device run shows the problem, re-show from a navigation `transitionEnd` / focus event on the host instead of the timer.
- **N3.** The base `claude/gracious-knuth-joxqpw` is 19 commits ahead again (Progress windows, Live Activity). `git merge-tree` shows no conflicts. Re-run the suite after the final merge.
- **N4.** `withSaveEdit` always sets `source: 'ben'`, even when Ben opens `Edit ›` on a coach draft and saves without changing anything. This matches `editRoutine` (WB8: saving from the editor makes it Ben's), so it is a note, not a bug. Record it in routines.md §A2.5 if that is the intent.
- **N5.** In `saveAs` mode, a stale overview preview (`Targets updated`) shows as an error inside the editor, and the only way out is `Cancel`. That brings the sheet back, and its Save then reports stale again. The behaviour is honest but takes two steps. Consider closing the editor and showing the host's `Targets updated` state directly.

---

## Creation paths vs the sets control (§10.4), re-checked on the merged tree

| Path | Sets control | Status |
|---|---|---|
| Library › Workouts `＋` › New workout | Editor card `SetShapeControl` and the add-sheet `SetCountBar` | OK (distance: S1) |
| `⋯` › Edit workout / Duplicate | Card `SetShapeControl` | OK |
| Editor `Replace` | Keeps the slot's sets | OK |
| Overview Edit › Add exercise | Sheet bar, then the row stepper | OK (TE-B15) |
| Empty workout / mid-workout Add exercise | Picker `SetCountBar` | OK (EL-B21/22) |
| Library detail › Add to a workout | Sheet `SetShapeControl` | OK. Distance is handled. |
| Save to Workouts (Summary, past workout, overview `⋯`, `FROM HISTORY`, Repeat) | Sheet `Edit ›` → editor | **OK (B2 fixed)** |
| Coach draft | Overview `⋯` › Save to Workouts › `Edit ›` | OK. Tested in `workout-builder.test.ts`. |
| Coach `add_exercise_today` | The coach picks the sets (rule 3); Ben adjusts them in the workout | OK. Recorded in §10.4. |

## Rule-by-rule

| Rule | Status |
|---|---|
| 1 Offline / honest AI | OK. `Edit ›`, the editor save and the Library header are all local. |
| 2 Completed sets / proposals | OK. Save-Edit writes a new workout only, and the source session is untouched (tested). |
| 3 Deterministic targets | OK. The UI computes no progression. A coach draft's RPE is kept through Edit (tested). |
| 4 Achievable loads | OK. Unchanged. |
| 5 Idempotent and versioned | Save-Edit: OK. The sheet's opId is reused, a retry or the sheet's own Save is the same workout, and the request is settled exactly once. Session add: N1. |
| 6 No invented data | OK. |
| 7 Credentials | No change. |
| 8 Imports as data | OK. |
| 9 Pain | OK. Unchanged from round 1. |
| 10 Your data / Coaching knowledge | OK. Round 1's N3 (aliases display) is still a nit. |
| Minimal copy | OK. `Edit ›`, with the VoiceOver label `Edit sets before saving`, and `Can't save distance yet`. |
| Accessibility | OK. 44pt `＋` and `Edit ›`, and the sets control now stacks at AX1 and above. |

## Spec issues

1. **EL-B13 now promises more than the code delivers.** The spec says "nothing is saved as reps", but the guard is only on the Library sheet (S1). Either fix S1, or narrow EL-B13 to the Library sheet and add a routines.md check for the editor.
2. **EL10–EL14 (fourth tab, Today's `Workouts` link retiring) still need Ben's confirmation** on the next build, recorded in `docs/brief/CHANGELOG.md` (carried over from round 1).

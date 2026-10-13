# Review r3: Library tab, Exercise detail and Sets when adding (claude/library-browse)

Reviewer: independent reviewer agent, 13 Oct 2026
Diff: `claude/gracious-knuth-joxqpw...claude/library-browse`. Round 3 covers the fix commit `7cdabf7` (r2 S1: a distance exercise can't be saved in a workout). I also re-checked every creation path against exercise-library.md §10.4 and re-ran the full checks.
Against: Ben on build 126, (1) "view exercises etc even when not in workout mode" and (2) "when creating a workout [I] should be able to select the number of sets per exercise". Also exercise-library.md §9–§10 (EL-B13 as revised), routines.md §A2.5 and the distance rule, and CLAUDE.md rules 1–10.

## Verdict: **PASS**

r2 S1 is fixed where it matters. The guard is now in the domain (`routineIssues(edit, isDistance)`), and all three write paths that take a free edit supply it from the exercise's measurement: `routines.create`, `routines.update` and `saveFrom({ edit })`. The editor's Add / Replace sheet shows distance rows disabled with `Can't save distance yet`. Domain and service tests cover each path, including the version staying at 1 after a refused update. The duplicate and stale checks still run before validation (rule 5).

Both of Ben's requests are still met. The Library is reachable outside a workout, and every creation path offers `Sets [−] n [+]` (table below).

One should-fix is new. It is a side effect of the fix on workouts that were saved before it (S1).

### Checks run (in /home/user/wt-browse, at 7cdabf7)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run` (default suite) | 275 files, 5237 passed, 1 todo, 0 failed |

## Round 2 findings

| # | Status | Notes |
|---|---|---|
| S1 Editor saves distance as reps | **Fixed** | `library.ts:59-66` (`routineIssues`), `createRoutine` / `editRoutine` / `withSaveEdit` take `isDistance`; `workout-services.ts:1490-1495` (`distanceOf`), wired at `:3058-3062`, `:3094-3095`, `:3235-3236`; `WorkoutEditorScreen.tsx:904-919` disables distance rows via `editorAddRow`. Tests: `packages/domain/test/library.test.ts` ("refuses a distance slot…"), `apps/mobile/test/workouts-library.test.ts` ("distance is never saved as reps…"). |
| N1 opId keyed on the count | Open | Unchanged. See N1. |
| N2 `REOPEN_AFTER_EDITOR_MS` timer | Open | Real-device check still needed. |
| N3 Base drift | Open | The base is 19 commits ahead; `git merge-tree` is clean. Re-run the suite after merging. |
| N4, N5 | Open | Unchanged. Still nits. |
| Spec issue 1 (EL-B13 overpromises) | **Resolved** | EL-B13 now names the editor sheet and all three write paths, which matches the code. |

---

## Blocking

None.

---

## Should fix

### S1. A workout saved with a distance slot before this fix can no longer be edited, and the editor doesn't say why

- **Where:** `apps/mobile/src/screens/routines/WorkoutEditorScreen.tsx:162` now passes `isDistance` into `routineIssues`. `editorPrimary` (`apps/mobile/src/workout/library-view.ts:125-131`) turns any issue other than a missing name or exercise into a bare `Fix 1 issue`. No card shows the distance issue: the only inline issue text is the reps min/max line at `WorkoutEditorScreen.tsx:815`. On the service side, `routines.update` (`workout-services.ts:3094-3096`) refuses any edit whose list still holds the slot, even a rename.
- **Failure scenario:** on build 126 (the base, before this fix) Ben used the editor's `Add exercise` to add Farmer's carry to "Legs A". It was stored as 3 × 8–10 reps, which is the r2 S1 bug. After updating, he opens Legs A › Edit to change squat sets from 3 to 4. `Save` is disabled and reads `Fix 1 issue`. Nothing on any card tells him which exercise is the problem or what it is, so he cannot save any change to that workout until he guesses to remove the carry. `Duplicate` (`workout-services.ts:3149-3158`, `duplicateRoutine`, no distance check) copies the slot, and the copy has the same problem.
- **Why it matters:** the editor is the screen Ben complained about in request (2). A disabled Save with no reason fails §12's task-completion target, and it is a regression for data that build 126 could have created.
- **Fix:**
  - Show the reason on the offending card: a `⚠ Can't save distance yet` line with `Remove` (or `Replace`), in the same style as the reps line.
  - Or make `editorPrimary` read `Can't save distance yet` when that is the only issue.
  - Optionally let `editRoutine` accept a distance slot that is unchanged from `current`, so legacy workouts still save other edits. Refuse only newly added distance slots.
  - Test: an editor view or unit test with a stored routine containing a distance slot shows the card-level reason, and removing the slot enables `Save`.

---

## Nits

- **N1.** (Still open since round 1.) `ExercisePickerScreen.tsx` and `WorkoutOverviewScreen.tsx` (`add:<id>:<sets>`) put the set count in the opId key. If the first response is lost, and Ben changes `Sets` and then retries, the retry adds a second row. Key the opId on exercise and equipment only.
- **N2.** `REOPEN_AFTER_EDITOR_MS = 450` (`SaveWorkoutSheet.tsx`). The sheet re-shows on a fixed timer, so on a slow device it may try to present before the editor has dismissed. Verify on a real device. If it fails, re-show on a transition-end or focus event instead.
- **N3.** Base drift (see the table above).
- **N4.** `distanceOf` (`workout-services.ts:1490-1495`) calls `exerciseById` once per distinct exercise on every create, update and save, in addition to `compoundOf`, which does the same lookups. At 40 exercises this is fine. Consider one lookup that returns both predicates.
- **N5.** Starting a legacy workout that has a distance slot still plans reps targets for it in the session. This is outside this branch, but worth one line in routines.md alongside the S1 decision.

---

## Creation paths vs the sets control (§10.4), re-checked at 7cdabf7

| Path | Sets control | Status |
|---|---|---|
| Library › Workouts `＋` › New workout | Editor card `SetShapeControl` and the add-sheet `SetCountBar` | OK. Distance is now disabled in the sheet and refused by the service. |
| `⋯` › Edit workout / Duplicate | Card `SetShapeControl` | OK (legacy distance: S1) |
| Editor `Replace` | Keeps the slot's sets; distance rows disabled | OK |
| Overview Edit › Add exercise | Sheet bar, then the row stepper | OK (TE-B15) |
| Empty workout / mid-workout Add exercise | Picker `SetCountBar` | OK (EL-B21/22) |
| Library detail › Add to a workout | Sheet `SetShapeControl` | OK |
| Save to Workouts (Summary, past workout, overview `⋯`, `FROM HISTORY`, Repeat) | Sheet `Edit ›` → editor | OK. `Edit ›` › Add of a distance exercise is now refused. |
| Coach draft | Overview `⋯` › Save to Workouts › `Edit ›` | OK |
| Coach `add_exercise_today` | The coach picks the sets (rule 3); Ben adjusts them in the workout | OK. Recorded in §10.4. |

## Rule-by-rule

| Rule | Status |
|---|---|
| 1 Offline / honest AI | OK. The distance check is a local read. |
| 2 Completed sets / proposals | OK. No session data is touched. |
| 3 Deterministic targets | OK. The UI computes no progression. |
| 4 Achievable loads | OK. Unchanged. |
| 5 Idempotent and versioned | OK. Duplicate and stale are checked before validation. A refused update leaves the version unchanged (tested). Session add: N1. |
| 6 No invented data | OK. A distance exercise is no longer given reps targets in new workouts. |
| 7 Credentials | No change. |
| 8 Imports as data | OK. |
| 9 Pain | OK. Unchanged. |
| 10 Your data / Coaching knowledge | OK. |
| Minimal copy | OK. `Can't save distance yet` reuses `NO_DISTANCE_IN_WORKOUTS`. The bare `Fix 1 issue` is S1. |
| Accessibility | OK. Disabled rows expose `accessibilityState.disabled`, and the subtitle is part of the row's label (`ui/layout.tsx:170-171`). |

## Spec issues

1. **Legacy distance slots are not covered by the spec.** EL-B13 and routines.md say what happens to new saves, but not what happens to a workout already stored with a distance slot (S1). Decide whether such a slot is kept, flagged on the card, or removed, and record it in routines.md.
2. **EL10–EL14 (fourth tab, Today's `Workouts` link retiring) still need Ben's confirmation** on the next build, recorded in `docs/brief/CHANGELOG.md` (carried over from rounds 1 and 2).

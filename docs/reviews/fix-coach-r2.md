VERDICT: PASS

# Review r2: coach bug fixes (`claude/fix-coach`)

Reviewer: independent `reviewer` agent, 11 Oct 2026.
Scope: `claude/gracious-knuth-joxqpw...claude/fix-coach`. All 7 bugs from the coach bug list, with a focus on the two commits since r1 (`docs/reviews/fix-coach.md`):
- `057d3e9`: Summary Undo all, action-level undo plus an atomic batch.
- `2717142`: source checks for the Undo wiring, and summary Try again says `Not sent.`

## Summary

- **R1 B1 is fixed at the root.** While the coach's `set_next_session_targets` record is live, `undoNextTargets(actionId, rows)` (`apps/mobile/src/coach/coach-service.ts:478-489`) now undoes the record as a whole with `undoOpId(actionId)`. That reverts every live row and sets `undoneBy` in one store transaction, so the coach-sheet card reads `Undone` with no Undo. The per-row path is used only once the record is already undone (the bug 7 path). It now goes through the new `setNextTargetStatuses`, which writes every tap or none (`packages/persistence/src/coach.ts:589-616`).
- **R1 S1 to S3 and N1 to N3 are addressed.** New tests cover the screen wiring, review-while-Offline, batch atomicity, and the overview after a rename.
- Every bug in the list now has at least one test that fails when its fix is removed. I checked this by mutation (table below).
- No rule regressions found. The only new visible string is `Not sent.`, which is the sheet's existing word for the same state, so it is within the minimal-copy rule.
- Remaining findings are nits.

## What I ran

| Check | Result |
|---|---|
| `npm run typecheck` | Exit 0 |
| `npm run lint` | Exit 0 |
| `npx vitest run --testTimeout=120000` | Exit 0. 179 files, 3651 passed, 1 todo |
| Mutation: B1. The action-level branch in `undoNextTargets` is disabled (always per-row) | `after Undo all, the review's card … reads Undone` fails ✔ |
| Mutation: S2. The `runSummaryTurn` gate is set back to `a.status !== 'ok'` | `a workout finished while the status still reads Offline …` fails ✔ |
| Mutation: S3. `setNextTargetStatuses` returns the refusal instead of throwing (partial commit) | `several row taps are one write …` fails ✔ |
| Mutation: bug 5. `WorkoutCoach` undo uses `newUuid()` | `every coach Undo passes undoOpId(actionId)` fails ✔ |
| Mutation: bug 5. Summary `tapNextTarget` uses `newUuid()` | `every Next-time row tap passes nextTargetTapOpId` fails ✔ |
| Mutation: bug 6. `workout` dropped from the `syncAdjustment` effect deps | `WorkoutCoach calls syncAdjustment in an effect that depends on the workout` fails ✔ |
| Mutation: N1. `setNotice('Not sent.')` removed from summary Try again | All `apps/mobile/test` pass (N1 below) |

The mutations for bugs 1 to 4 and 7 were run in r1 and the tests are unchanged. After each mutation the worktree was restored (`git checkout -- apps packages`), and it is clean.

## Per-bug verdict

| # | Bug | Root fix? | Test fails without fix? |
|---|---|---|---|
| 1 | CA4 re-offers on coach-sourced sets | Yes (see r1) | Yes |
| 2 | Offline sticks; review skipped and cached | Yes. Timed lapse; review runs when Offline; skipped or failed runs not cached | Yes, now including the run-while-Offline case |
| 3 | Rename or time edit drops the targets | Yes. Content basis (`nextTargetSourceBasis`) | Yes, for start and overview |
| 4 | Try again dead or wrong | Yes. Per-row input; summary turns re-run unless completed | Yes |
| 5 | Double-tap Undo reports a failure | Yes. `undoOpId` / `nextTargetTapOpId` | Yes (source checks) |
| 6 | Banner keeps a live Undo after the sheet's Undo | Yes. `syncAdjustment` effect on `workout` | Yes (source check plus helper test) |
| 7 | Second Undo all does nothing | Yes. Action-level undo while live, else an atomic row batch | Yes |

## Blocking

None.

## Should fix

None.

## Nits

### N1. `Not sent.` on a summary Try again is untested, and it can be wrong when a review has just completed

**Where:** `apps/mobile/src/screens/coach/CoachSheetScreen.tsx:224-225`, and `coach-service.ts:381` (`runSummaryTurn` returns null when a completed summary turn exists).

**Scenario:** the Summary's own review completes while Ben is tapping Try again on an earlier interrupted summary row in the sheet (rare). `runSummaryTurn` returns null because a completed turn now exists, and the sheet says `Not sent.` even though the review is there. Removing the line also fails no test.

**Fix:** tell "skipped: can't answer" apart from "already reviewed". For example, return a reason, or re-load the thread instead of setting the notice when a completed summary turn exists. Add a small test.

### N2. The action-level Undo all ignores the row versions Ben saw

**Where:** `coach-service.ts:478-482`.

While the record is live, the `rows` argument is unused. `revertIn` reverts every `saved` or `applied` row of the action, including rows the Summary shows as stale (`Rule`). Because an undo only ever moves rows backwards and stale rows are not used, this is harmless. Note it in the doc comment, or drop the parameter from that branch.

### N3. Pre-existing: the sheet card still offers Undo after every row was undone one at a time

**Where:** `apps/mobile/src/coach/sheet-view.ts:129`.

`canUndo` reads only `undoneBy`. If Ben undoes each Next-time row one by one on the Summary (not Undo all), the review's card in the sheet still says `Applied` with Undo, and tapping it gives "Couldn't undo: it changed since". This branch didn't cause it, and it isn't in the bug list. It is the same class of issue as r1 B1, so it is worth a follow-up: derive the card's state for `set_next_session_targets` from whether any of its rows are still live.

## Rules check

| Rule | Result |
|---|---|
| 1 | Logging is untouched. The review is attempted when Offline. A real failure is shown as a failure, with no canned reply. |
| 2 | Undo all, the row Undo and the sheet card now agree. Undo all is atomic and replays on a double tap. |
| 3 | The CA4 once-per-exercise limit is restored. |
| 4, 9 | No change to snapping, equipment bounds or pain gating. |
| 5 | Op IDs are deterministic per intent. The batch is all-or-nothing. Stale rows are still refused (`changed_since`). |
| 6 | Stale coach rows show the rule's target. |
| 7, 8, 10 | Not touched. No secrets, and no new logging of health data. |

Minimal copy: the only new strings are `Not sent.` (already used by `send`) and the existing `Couldn't undo.` toast. There are no explanations or reassurance lines.

## Spec issues

The r1 spec issue still stands: `docs/design/coach-sheet.md:302` says Offline "clears by itself when the network returns", but the app has no reachability source, so the fix uses a 60 s lapse. Ben or the designer should either accept a timed lapse in the spec or approve a reachability dependency (with an ADR).

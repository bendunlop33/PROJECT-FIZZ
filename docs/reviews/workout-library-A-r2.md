# Review: Workouts library, slice A (round 2)

Branch `claude/workout-library` at `4235b6a` vs `claude/gracious-knuth-joxqpw`. Round 1: `docs/reviews/workout-library-A.md` (`fa64f8a`). This round covers the three fix commits `e2aa454`, `b865368` and `4235b6a`, and re-checks the slice as a whole.
Spec: `docs/design/routines.md` Part A (WL1–WL10, §A2–§A7, WL-A1–A16), mockup `docs/design/mockups/workout-library.html`, CLAUDE.md rules 1–10, minimal copy.
Reviewer: independent reviewer, 12 Oct 2026.

## Verdict: **CHANGES NEEDED**

Most of round 1 is fixed. S1–S5, N2–N5, N8 and N9 are all addressed and tested. One part of B1 is still open. A coach next-session target still overwrites the rep range Ben sets in the editor after the target was saved, along with a load the coach chose for those reps. WL-A4 ("change reps to 6–8 … The overview shows the new structure") therefore still fails whenever the coach is connected, and the branch's own tests assert that behaviour. One should-fix is new: the "edited since the target" check is too coarse, so the coach's set count is dropped without any sign, even in the most common case.

## Checks run

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run --testTimeout=120000` (full) | 3934 pass, 5 fail, 1 todo. All 5 failures are timing or perf bounds in files this branch doesn't touch: `catalogue/test/definition.test.ts` D6, `domain/test/equipment.test.ts` M8, `persistence/test/backup-perf.test.ts` (×2) and `persistence/test/data-domains-perf.test.ts`. Other agents' suites were running at the same time (load average about 20). |
| The 4 failing files rerun on their own | all pass (40 + 40 + 2 + 1). These are load flakes, not regressions. |
| New tests | `domain/test/library-coach-targets.test.ts`, the S2/S3/S5/N4 block in `domain/test/library.test.ts`, `mobile/test/library-coach-target.test.ts` (B1 through overview and Start with a scripted coach), the S2/S4/S5/N5 block in `mobile/test/workouts-library.test.ts`, and the S1 navigation test. All pass. |

## Round 1 status

| Item | Status |
|---|---|
| B1 coach target replaces the structure | **Partly fixed.** Set types and (when edited) set count now survive. Reps don't (B1 below). |
| S1 Duplicate's Undo unreachable | Fixed. `copyToast` comes back on Cancel and Discard, and Save's Undo deletes the copy. The editor is `gestureEnabled: false`, so there is no swipe-back path that bypasses it. Tested. |
| S2 overview save drops Fixed, Main, item | Fixed (`planSettingsOfRoutine`). A swapped row keeps only `Main`. Tested. |
| S3 Keep both turns stale actuals into pins | Fixed (`editableEdit` on both base and theirs). Tested. |
| S4 Repeat saves source, not preview | Fixed (`kind: 'repeat'`, the same `repeatPlan` as the screen, owner-checked). Tested at a 25 kg rack. |
| S5 default rest frozen | Fixed. Only `routine_set_type` rest and `set_override` rest are copied. Tested. |
| N2 `Routine not found.` | Fixed. |
| N3 delete wording | Fixed (`LIBRARY_TOASTS.deleted` in Today and the overview). |
| N4 change lines on a legacy workout | Fixed. |
| N5 duplicate of a tombstoned workout | Fixed. A retry of an earlier copy still replays. Tested. |
| N8 Past workouts lead paragraph | Removed. |
| N9 item pinned on unpinned slots | Fixed. |
| N1, N6, N7, spec issues 1–4 | Open (see the nits and spec issues below). No spec text changed this round. |

## Blocking

### B1. A coach target still overwrites Ben's later rep range, and puts a load chosen for other reps on his sets (remainder of round 1 B1)

- `packages/domain/src/session/routines.ts:452`: `return { ...t, id, targetLoad: coachPlan.load, targetReps: coachPlan.reps ?? t.targetReps };`. This runs on every Auto template of the matched type, whether or not the workout was edited after the target (`unedited`, `:445`, only gates the set count).
- The tests lock this in:
  - `packages/domain/test/library-coach-targets.test.ts:64`: "edited after the target was saved: … the coach's load and reps still apply". The templates are 6–8 and the output is `100×5–5`.
  - `:147`: Ben's new `Top 4–6` comes out as `8–10` at 35 kg each.
  - `apps/mobile/test/library-coach-target.test.ts:110`: the overview shows `1 × 5` for the Top set Ben made `4–6`.
- Commit `e2aa454` says "The workout's set types, counts **and reps** stay the structure". The code doesn't do that.
- Failure scenario (coach connected, the default under D21):
  1. Ben finishes Push A. The coach saves Incline: 35 kg each × 8–10.
  2. A day later Ben opens the editor and changes Incline to `6–8` (WL-A4's own step), then saves (`Saved Push A`).
  3. The overview and Start show Incline at 8–10 × 35 kg each. His 6–8 is silently not honoured. Had he moved to 12–15, he would get 8–10 at a load picked for 8–10.
- This is the same outcome round 1 named: "Incline back at the coach's set count and reps". It still breaks WL-A4 and WL7 ("keeps … rep ranges"). It also breaks the CLAUDE.md rule 3 split: small coach adjustments must not override Ben's own structural edits.
- Round 1's suggested fix said "apply the coach row's load and reps to the Auto working sets". That wording was too loose and is partly the source of this. The intent was that Ben's later edit wins.
- Fix: when the workout has been edited since the target (the same test as `:445`, with S1 below applied):
  - Keep the template's `targetReps` (or `targetDurationS`).
  - Use the coach load only if the coach's reps fall inside the template's range. Otherwise use the built-in rule's load for that set, taken from `meta.builtIn` the way the other set types already do.
  - When not edited, the current behaviour is fine.
- Tests:
  - Flip `library-coach-targets.test.ts:64` and `:147` to expect Ben's reps.
  - Add a service-level case: reps changed to 6–8 after a 8–10 target, then check overview == Start == 6–8.

## Should fix

### S1. "Edited since the target" is any write to the workout, so the coach's set count is dropped silently, most often on the very first next session

- The check is `packages/domain/src/session/routines.ts:445`, fed by `routine.updatedAtUtc`. `routineWrite` (`routines.ts:227`) bumps that time for rename, rotation on/off, delete/restore and Undo, as well as for editor saves.
- The target's time is `row.createdAtUtc` (`packages/domain/src/coach/next-session.ts:312`). That is the time the coach first wrote the row, not the time it became active. A target Ben `Apply`s later, or re-applies after Undo, keeps the old time.
- Failure scenario: the Summary coach turn runs and saves "Bench: 2 sets × 57.5 kg × 5 (every set RPE 10)" with its reason and Undo on the Summary. Ben then taps `Save to Workouts` on the same Summary. The new workout's `updatedAtUtc` is later than the target, so next time Start shows 3 sets. The Summary told him 2, nothing on the overview says why, and the coach's adjustment is half-applied without a word. Toggling `Add to rotation` does the same.
- The harness test (`library-coach-target.test.ts`, `withCoachTarget`) saves the workout *before* the coach turn, so it never covers this order.
- Fix:
  - Compare against the time the slot's structure last changed, not any write. For example, store `structureChangedAtUtc` on editor and Keep-both saves only, or compare the slot's templates with the source session's shape.
  - Use the target's activation time (`updatedAtUtc` when status became `saved` or `applied`).
  - When the coach's count is not used, say so in the set's `Why?` (one short line).
  - Add a test with the Summary order (target first, then `Save to Workouts`).

### S2. The coach's reps can be written onto a timed template

- `routines.ts:452`: `targetReps: coachPlan.reps ?? t.targetReps` doesn't clear `targetDurationS`. If a timed template matches the type and the coach's target has reps, the template ends up with both.
- This is unlikely today (the source would also be timed), but it is an invalid shape the planner then has to guess at.
- Fix: only set reps on a template that has `targetReps`, or leave timed templates untouched. This falls out of the B1 fix.

## Nits

- **N1.** (Carried over.) The `＋` menu has no `New with coach` or `Coach offline` entry. There is no `Edit order` or `Set up rotation ›` on `YOUR ROTATION`, and no Plan hub `Workouts` segment. These depend on screens that aren't built yet. Record that in the spec (spec issue 3).
- **N6.** (Carried over.) Saving a `FROM HISTORY` row under a new name links only the newest session through `createdFromSessionId`, so the older sessions stay as a `FROM HISTORY` row.
- **N7.** (Carried over.) The editor's Fixed load stepper stops at the rack max. Reaching 37.5 kg on a 30 kg rack (WL-A4) needs typed entry. Confirm it on device.
- **N10.** `SaveFrom { kind: 'session', keepLoads }` now has no caller with `keepLoads: true` (Repeat moved to `kind: 'repeat'`). Remove the flag, or note what still uses it.
- **N11.** A fresh copy's editor Save offers Undo as *delete the copy* (`WorkoutEditorScreen.tsx:190`). That matches S1's intent. But if Ben has made real edits, the toast `Saved Push A copy` [Undo] now throws them away along with the copy. That's acceptable, but worth a line in §A5.

## What's good

- **Rule 2:** saving from Summary, Past workouts, Repeat or an overview never changes the finished or running workout. Nothing in the fixes touches completed sets.
- **Rule 4:** Repeat's save stores the loads fitted to the gym (25 kg each), never the 32.5 kg that isn't achievable there (tested).
- **Rule 5:**
  - Every new write path keeps the opId and version discipline. `kind: 'repeat'` goes through the same `createOnce`.
  - Duplicate refuses a tombstone but replays an earlier opId.
  - The copy's delete-Undo is version-checked.
- **Preview == start:** Repeat's screen and its save share `repeatPlan`. The overview and Start share the planner, including the new coach path (asserted at service level).
- **Migration:** none. `NextTargetEntry.coach` and `TodayPlanInfo.setTemplateIds` are in-memory only.
- **Rules 1, 7, 8, 10:** no provider calls in the library paths. No secrets and no new logging of health data.
- **Minimal copy:** the Past workouts lead paragraph is gone, and the delete wording is unified.

## Tests: gaps to close

- B1: a rep change after a coach target, at domain and service level. Flip the two domain tests that currently assert the coach's reps.
- S1: the coach target is saved first, then `Save to Workouts` on the same Summary, and then the next Start. Also a rotation toggle after the target.

## Spec issues

1. **Coach target vs Ben's later edit (round 1 spec issue 1, still open).** §A/WL7 still doesn't say which wins. The developer took round 1's proposal literally ("coach supplies load and reps"). The proposal should read: Ben's later edit to a slot wins on set count *and* reps. The coach target supplies load only where its reps fit his range, otherwise the built-in rule does. The coach's set count applies only if the slot's structure hasn't changed since the target became active. Ben should confirm, and the spec should define "changed" (structure, not rename or rotation).
2. **Round 1 spec issues 2–4** (the `routineFromPlan` contract keeping the workout's own settings, Part A's dependence on the Plan hub, Edit rotation and the workout builder, and WL-A10's FitNotes Category fixture) have no spec text yet. Issue 2 is now implemented, so §A6 should be updated to match `planSettingsOfRoutine`.

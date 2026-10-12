# Review: Workouts library, slice A (round 3)

Branch `claude/workout-library` at `d0867da` vs `claude/gracious-knuth-joxqpw`. Earlier rounds: `workout-library-A.md` (`fa64f8a`), `workout-library-A-r2.md` (`9ae12a3`). This round covers the fix commits `cb1786f`, `c8d99d8` and `d0867da`, and re-checks the slice as a whole.
Spec: `docs/design/routines.md` Part A (WL1–WL10, §A2–§A7, WL-A1–A16), mockup `docs/design/mockups/workout-library.html`, CLAUDE.md rules 1–10, minimal copy.
Reviewer: independent reviewer, 12 Oct 2026.

## Verdict: **PASS**

Round 2's blocking issue, both should-fixes and N10 are fixed and tested at domain and service level. The open nits (N1, N6, N7, N11) and the spec issues are now written into the spec. No new blocking or should-fix issues were found. What remains is a few nits and one spec decision Ben has to make (WL7 is marked "proposed; Ben to confirm").

## Checks run

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run --testTimeout=120000` (full) | 3949 pass, 5 fail, 1 todo (200 files). All 5 failures are timing or perf bounds in files this branch doesn't touch: `catalogue/test/definition.test.ts` D6, `persistence/test/backup-perf.test.ts` (×2), `persistence/test/data-domains-perf.test.ts` and `mobile/test/backup-perf.test.ts`. Load average was 22–25 because other worktrees' suites were running. |
| The 4 failing files rerun on their own | 43/44 pass. D6 timed out again at its own hard-coded 60 s limit (load average 13). |
| D6 rerun on its own (`-t D6`) | pass. These are load flakes, not regressions. `git diff --stat` shows none of these files changed on the branch. |
| New tests | The B1/S1/S2 block in `domain/test/library-coach-targets.test.ts`, the `structureChangedAtUtc` block in `domain/test/library.test.ts`, and `mobile/test/library-coach-target.test.ts` (WL-A4 rep change, 4-set edit with `Why?`, Summary order target then Save, rename and rotation toggle). All pass. |

## Round 2 status

| Item | Status |
|---|---|
| B1 coach target overwrote Ben's later reps | **Fixed.** `routineTemplatesWithTargets` (`packages/domain/src/session/routines.ts:436-484`) keeps the slot's count and reps when the slot changed after the target. The coach's load is used only where its reps fit his range (`fitsRange`). Otherwise the built-in rule's load is used, and `Why?` gets `Kept your edit: …`. The domain tests that asserted the old behaviour were flipped. The service test checks WL-A4 end to end with overview == Start (`3 × 6–8`, same load). |
| S1 "edited since" was any write | **Fixed.** `RoutineExercise.structureChangedAtUtc` (`packages/schemas/src/routine.ts:72`) is set only by `withStructureTimes` (`library.ts:160`, editor save, per slot, compared on exercise, set types, load, reps and time) and `swapRoutineSlot` (`routines.ts:651`). Rename, rotation, delete/restore, rest, `Main` and order leave it alone. The target's time is now `row.updatedAtUtc` (`next-session.ts:314`), which `nextTargetStatusIn` bumps on `undone → saved` and `proposed → applied`. Tested in the Summary order (target, then `Save to Workouts`), and with rename plus rotation toggle and Apply-after-edit. |
| S2 coach reps onto a timed template | **Fixed.** Timed sets are skipped (`t.targetReps === null`) and take the rule's load (tested). |
| N10 unused `keepLoads` | Removed. |
| N1, N6, N7, N11 | Recorded in the spec (§A2.2 "Depends on later slices", the WL-A acceptance list, WL-A4's typed-entry note, §A5 copy note). N6 is open for Ben to decide. |
| Spec issues 1–2 (r2) | WL7 now states the rule (marked proposed). §A6's `routineFromPlan` contract matches `planSettingsOfRoutine`. WL-A10 notes the named-type fixture. |

I also checked the following during this round:

- **Every routine write path:** only `editRoutine` and `swapRoutineSlot` change a slot's structure, and both set the time. The edit Undo (`drafts.ts:55`) restores `before.exercises` with their old times, and swap Undo (`drafts.ts:64`) restores `slot.before`. After Undo, the coach target applies again, which is correct because the structure is back to what the coach saw.
- **Keep both:** `editRoutine` runs against the newer version, so a slot changed only on the other side keeps that side's time.
- **Slot IDs:** the editor's `services.routines.editor` returns `editableExercises(routine)` with stored slot IDs, so an editor save that changes nothing doesn't mark slots.
- **Fixed pins:** `withRuleLoads` still skips `targetLoad !== null`, and the new `include` predicate doesn't change that.
- **Migration:** none. The new field is optional in a JSON document validated by `RoutineSchema`, so old routines and backups parse.

## Blocking

None.

## Should fix

None.

## Nits

- **N12.** `structureShape` (`packages/domain/src/session/library.ts:150`) compares slots with `JSON.stringify`, so the result depends on key order in `targetLoad` and `targetReps`. Today the order matches: the editor builds `{ value, unit, convention }` in schema order, and stored documents come out of `RoutineSchema.parse`. If some later code path builds a load in a different key order, an unchanged slot would read as "changed" and the coach's count and reps would be dropped without a reason. Fix: compare fields explicitly (`value`, `unit`, `convention`, `min`, `max`).
- **N13.** When the coach's reps don't fit Ben's edited range, the fallback is the built-in rule's load from `meta.builtIn`. That load was planned from the source session's reps (8–10), not Ben's new 6–8. This is the same thing that happens with no coach at all, so it's consistent and not a regression. Worth a line in the built-in rule's backlog if rep-range-aware loads are wanted.
- **N14.** The coach row's `Why?` still shows `setAt` from `row.createdAtUtc` (`next-session.ts:305`), while the comparison now uses `updatedAtUtc`. For a target Ben Applied later, `Why?` shows the earlier time. Harmless, but the two can disagree.
- **N15.** Test gaps, low risk:
  - No service test for Undo of an editor save made after a coach target. The coach's count should come back.
  - No service test for `Keep both` setting `structureChangedAtUtc` only on Ben's changed slots.
  - The domain logic covers both, by reading the code.
- **N16.** In `routines.md` §A7 the `Open (N6, Ben to decide)` bullet sits inside the numbered WL-A acceptance list, between WL-A9 and WL-A10. Move it under "Open questions" so the acceptance list stays checkable.
- **N1, N6, N7** (carried over): now documented as depending on later slices or as Ben decisions. No code change expected in slice A. N7 (typed entry of 37.5 kg past the rack max) still needs a device check.

## What's good

- **Rule 3:** Ben's own later structural edit now beats an automatic target. The coach's small adjustment still applies whenever the slot hasn't changed. When something isn't applied, the reason is one line behind `Why?`, not in the main UI.
- **Rules 4 and 5:** loads still go through the shared fit, and Fixed pins are untouched. Every write keeps the opId and version discipline, and no new write path was added.
- **Preview == start:** the overview and Start share `planRoutineStart`. The new edited-slot tests assert the same set count, reps and load on both.
- **Rule 2:** nothing touches finished or running workouts.
- **Rules 1, 7, 8, 10:** no provider calls in these paths, no secrets and no new logging.
- **Minimal copy:** `Kept your edit: 4 sets, 6–8 reps` lives only in `Why?`.

## Spec issues

1. **WL7 is implemented but still marked "proposed in review r1/r2; Ben to confirm".** Ben should confirm or amend the rule before the slice merges, and record it in `docs/brief/CHANGELOG.md` if it amends D21. The rule is: Ben's later slot edit wins on count and reps, the coach's load applies only where its reps fit, and otherwise the built-in rule's load does. The code and tests encode it, so a different decision means changing `routineTemplatesWithTargets` and its tests.
2. **N6 (open):** saving a `FROM HISTORY` row under another name leaves the older sessions as a `FROM HISTORY` row. Ben decides between leaving it as is and hiding the type once any of its sessions is saved.

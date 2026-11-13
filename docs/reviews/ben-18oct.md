# Review: Ben 18 Oct (build 156 reports), branch `claude/ben-18oct`

Diff reviewed: `5237060..HEAD` (`3abdcc1`, `7978f99`, `998c9c5`). Reviewer: independent.

## Verdict: **CHANGES NEEDED**

## Scope

Ben's own request for this run covers only report C ("make a body weight eg lower back
extensions to be including weight"). The developer built C and left A (coach ignores the
length and gym) and B (mid-workout "Too easy") for Ben to confirm. That follows his
request, so this review judges C on its merits and does not count A and B as defects.
For the record:

- **A is not fixed.** `propose_workout` still has no `minutes`, and "make it 40" still
  falls through `parseRequestedMinutes`. Gym-name matching is unchanged.
- **B is not fixed.** The live context does not name the last logged set, and a reply to
  a coach question is not treated as Ben asking.

Both are still on Ben's list.

## Checks run

- `npm run typecheck`: clean. `npm run lint`: clean.
- `npx vitest run packages/domain/test/added-weight.test.ts packages/persistence/test/added-weight.test.ts`: 13 passed.
- `npx vitest run packages/domain packages/persistence packages/schemas --maxWorkers=4`: 137 files, 2764 tests passed. The full suite with `--maxWorkers=2` did not finish within the 10-minute tool limit, so I did not re-run all of it.
- I ran throwaway probe tests (deleted afterwards). Their results are cited below.

## Blocking

### B1. Added weight on a typical bodyweight row is never checked against the gym (rule 4)

- **Where:**
  - `packages/domain/src/session/active-view.ts:1146-1153`: `snapPlannedLoad` only takes the added-weight path when the row's own item is a `bodyweight_station`, and it passes `undefined` for the bodyweight set.
  - `packages/domain/src/added-weight.ts:22` (`canAddWeight`).
  - `packages/domain/src/session/reducer.ts:250` (`checkEquipmentOf`, which has no bodyweight-exercise flag), `:308` (`flagsFor`), `:1156` (`edit_planned_set`) and `:1531` (`adjust_pending_targets`).
- **Why it happens:** a bodyweight exercise's session row has `equipmentId: null`. That is true even when the gym has a bodyweight station. A probe started with a station plus dumbbells and the row still had `equipmentId` null. On that row, `isWeightedBodyweight(row, null, false)` is false, so every reducer-side and planned-edit check falls back to "no equipment, unchecked".
- **Failure scenario (probe, dumbbells 5/10/20 kg, weighted 45° back extension):**
  - Ben types 47 in Edit set for a pending set. `snapPlannedLoad` returns 47 and `edit_planned_set` accepts it, so the target is 47 kg added at a gym whose heaviest item is 20 kg.
  - `log_set` with 47.3 kg added is accepted with `flags: []`. No `off_profile_load` flag is set and the set card shows no warning (`active-view.ts:586` checks the row's own null item).
  - `adjust_pending_targets` with 99 kg added is accepted by the reducer. The coach path is refused earlier in `snapLoad` (`packages/domain/src/coach/adjust.ts:182`), so only the deterministic guard is missing. Any other caller, such as a rule-sourced adjustment, gets no rule 4 backstop.
- **Why this blocks:** the spec says "Loads snap to the gym's dumbbells/plates". The developer's open question 3 says closing this gap needs a migration. That is not true for the planned-edit path: `workout-services.ts:2485` already holds `data.bodyweightExercises`.
- **Fix:**
  1. Pass `bodyweightExercises` into `snapPlannedLoad`. Use `loadCheckEquipment(ex, own, …, bw.has(ex.exerciseId))` for any `added` row whose catalogue default is bodyweight, not only rows on a station.
  2. Give the reducer a marker it can read without a migration. Options: set a flag on the row when `set_load_mode`/start makes it weighted (if the row has a JSON field), or stamp it into each pending set's `planned` JSON, which is already a JSON column. `edit_planned_set`, `adjust_pending_targets` and `flagsFor` can then check against `addedWeightEquipment`.
  3. Add tests for the null-equipment row: a typed planned load gets snapped, an impossible target is refused, and an over-max log gets the flag.

## Should fix

### S1. Toggling `Bodyweight` and then `+ Weight` deletes every pending target, with no Undo

- **Where:** `reducer.ts:2090-2110` (`handleSetLoadMode`) together with `withoutEditRecords`.
- **Failure scenario:** Ben starts a saved workout with Add weight and Fixed 10 kg targets, then accidentally taps `Bodyweight`, which sits directly under the steppers. All pending loads, plus any coach `planned.coach` / `planned.edit` records, are cleared. Tapping `+ Weight` again gives `[null, null]` (probe), so the targets and the coach's Undo record are gone.
- **Why it matters:** this is not a completed-set violation, but a one-tap destructive change with no Undo goes against the rule 3 pattern of a visible change with one-tap Undo.
- **Fix:** make the switch reversible. Either keep the other mode's planned load (for example `planned.loadOtherMode`) and restore it on the way back, or register `set_load_mode` with `undo_op` and show the usual Undo toast.

### S2. Edit set's mode switch can fail silently and is not atomic with the correction

- **Where:** `apps/mobile/src/screens/workout/EditSetScreen.tsx:131-137`.
- **What happens:** `correct_set` succeeds, then `set_load_mode` is sent as a second write. If it fails (for example `stale_version`), `m.ok === false` is ignored. Ben sees his corrected set as `BW + 10 kg`, but the remaining sets stay bodyweight with no message.
- **Fix:** show the refusal, or reload and retry once.

### S3. Next-session targets, Last, gym switch and coach behaviour on weighted rows are untested

- **What's missing:** the spec asks for tests of "switch/snap/history logic". Nothing tests:
  - next-session targets from a weighted history (the built-in rule plus the fit at Start);
  - `Last` showing `BW + 10 kg` and skipping across modes (`active-view.ts:68`);
  - `change_gym` on a weighted row (`gym-switch.ts:432` passes the convention through);
  - `routineFromPlan` / repeat setting `addedWeight`;
  - a coach load on a weighted row being refused while a reps change still applies.
- **Fix:** add one domain test for each.

### S4. The coach cannot raise or lower added weight, and its refusal note is misleading

- **Where:** `packages/domain/src/coach/adjust.ts:182`.
- **Failure scenario:** on a weighted back extension, "Too easy" leads to a load change that is refused with "no equipment is set". For a weighted row that wording is wrong: the gym's dumbbells and plates are known.
- **Fix:** once B1 adds a marker, let `snapLoad` use `addedWeightEquipment` for rows that are already weighted. That is allowed by the spec ("may only use 'added' … when it's already weighted"). Until then, change the note to say the coach can't change added weight.

### S5. `conventionFits` widens what any no-equipment row accepts

- **Where:** `reducer.ts` (`conventionFits`, around line 262).
- **What happens:** any row with `added` and no equipment (a sled push, or a leg press whose machine is absent) now accepts a `bodyweight` load, and the reverse also passes.
- **Fix:** scope it to bodyweight-catalogue rows once the marker from B1 exists.

## Nits

- `PlannedSetEdit.toggleWeight` creates a new `opId` on every tap. That is fine for a toggle, but a double tap sends two versioned writes, and the second fails as stale and shows a toast. Disable the button while busy.
- `loadSteps` reads `stepWord(eq === own ? eq : null)`, so the max reason on weighted rows has no noun. That is acceptable under the minimal-copy rule.

## Product rules

- Offline logging is local only, so it is fine.
- Logged sets are not modified: verified by the reducer test and by reading the code.
- Writes are versioned and idempotent: `set_load_mode` is version-gated, and a retried `opId` returns a duplicate.
- No secrets were added, and no invented data: there is no bodyweight-inclusive number, and `estimateOneRepMax` refuses an `added` load without a plate-loaded machine.
- Rule 4 is not met: see B1.

## Spec issues

- **Combining items:** "Snap to the gym's dumbbells/plates" doesn't say whether items combine. The build allows combinations but caps the total at the heaviest single item. With 20 kg dumbbells that allows 10 + 1.25 but not 20 + 5 on a dip belt, which is an internally odd model. Ben needs to choose between single items only and sums up to what a belt or vest can hold (developer open question 1).
- **Last after switching modes:** the spec says Last uses the added mass, but it doesn't say what Last shows when today's mode differs from last time's.
